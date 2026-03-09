# Scraper-WNBA

WNBA (and optionally NBA/G-League) scraper for [Basketball Reference](https://www.basketball-reference.com). Scrapes player data; WNBA mode writes to `data/wnba_players.json`; NBA/G-League use Postgres and a job queue.

## Railway (WNBA)

- **Service must use this repo.** If deploy logs show `scraper-nba@1.0.0` or the error `Must be one of: nba, gleague` (without **wnba**), Railway is running old/different code. Connect the service to **this** repo (Scraper-WNBA), trigger a **new deploy** from the latest `main`, and optionally set **`SCRAPER_LEAGUE=wnba`** (defaults to `wnba` if unset).
- When the correct code runs, the first log line is: `[Scraper-WNBA] runPlayerWorkers.js — leagues: nba, gleague, wnba (default: wnba)`.

---

# Scraper-NBA (shared worker layout)

Production-ready NBA scraper for [Basketball Reference](https://www.basketball-reference.com). Scrapes all NBA player data and stores it in PostgreSQL.

## Requirements

- Node.js 18+
- PostgreSQL with `DATABASE_URL` set

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and set DATABASE_URL to your PostgreSQL connection string
npm run migrate
```

## Usage

1. **Generate jobs** – Fetch all player URLs from Basketball Reference and enqueue them:

   ```bash
   npm run generate-jobs
   ```

   To **clear the queue and refill with the full index** (~5,400 players), use:

   ```bash
   npm run regenerate-jobs
   ```

   Use `regenerate-jobs` after a fresh deploy or if team rosters in Hoop Central look incomplete (only ~800 players instead of thousands).

2. **Run workers** – Process the queue (run in one or more terminals for parallel workers):

   ```bash
   npm run workers
   ```

Workers run until the queue is empty, then poll for new jobs every few seconds.

## Data populated

- **leagues** – NBA (from migration)
- **seasons** – One row per season (e.g. 2003–04)
- **teams** – NBA teams (created as seen on player pages)
- **team_seasons** – Links teams to seasons
- **players** – One row per player, keyed by `sr_player_id` (Basketball Reference player id, e.g. `jamesle01`)
- **player_external_ids** – `source = 'basketball_reference'`, `external_id = sr_player_id`
- **player_seasons** – Player + team_season + jersey_number + games_played
- **player_season_stats** – games, minutes, points, rebounds, assists, steals, blocks, fg_pct, three_pct, ft_pct

## Behavior

- **No duplicate players** – Inserts are skipped if `sr_player_id` already exists.
- **Rate limiting** – 2–4 second delay between requests; 429 responses trigger exponential backoff and retry.
- **Retries** – Failed jobs are retried up to 3 times before being marked `failed`.
- **Conversions** – Height (e.g. `6-9`) → `height_cm`, weight (e.g. `250lb`) → `weight_kg`, birth dates → PostgreSQL date.

## Project layout

```
scrapers/     # playerIndexScraper, playerProfileScraper, playerSeasonScraper
services/     # playerService, teamService, seasonService, statsService
db/           # db.js, schema.sql, migrate.js
utils/        # rateLimiter, conversions, retry
jobs/         # generatePlayerJobs, runPlayerWorkers
```

## Commands

| Command                  | Description                                                |
|--------------------------|------------------------------------------------------------|
| `npm run migrate`        | Apply schema (creates tables if missing)                   |
| `npm run generate-jobs` | Enqueue all player URLs from index (skips existing URLs)   |
| `npm run regenerate-jobs` | Clear job queue and enqueue full index (~5,400 players)  |
| `npm run workers`       | Run a single worker (run multiple for concurrency)        |

## Railway: player_scrape_jobs schema

The scraper expects `player_scrape_jobs` to have: **id**, **player_url**, **status**, **attempts**, **last_error**, **created_at**, **updated_at**. It does not modify the database; it only reads and writes using this structure.

1. **Run the full migration** (creates all tables): connect to your Railway Postgres and run the SQL in `db/schema.sql`, or run `npm run migrate` locally with `DATABASE_URL` set to your Railway Postgres URL.
2. **Create/fix only the jobs table**: run the SQL in `db/fix-player-scrape-jobs.sql` against your Railway Postgres (Option A creates the table; Option B adds missing columns to an existing table).

After fixing the schema, redeploy or restart the Scraper-NBA service.
