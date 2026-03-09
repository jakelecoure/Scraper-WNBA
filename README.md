# Scraper-WNBA

WNBA (and optionally NBA/G-League) scraper for [Basketball Reference](https://www.basketball-reference.com). All leagues use the **same job queue and Postgres**: workers claim jobs by `SCRAPER_LEAGUE`, scrape the player, and persist to the database (players, seasons, teams, stats).

## Railway (WNBA)

- **Service must use this repo.** If deploy logs show `scraper-nba@1.0.0` or the error `Must be one of: nba, gleague` (without **wnba**), Railway is running old/different code. Connect the service to **this** repo (Scraper-WNBA), trigger a **new deploy** from the latest `main`, and optionally set **`SCRAPER_LEAGUE=wnba`** (defaults to `wnba` if unset).
- When the correct code runs, the first log line is: `[Scraper-WNBA] runPlayerWorkers.js — leagues: nba, gleague, wnba (default: wnba)`.
- **Push WNBA data to Postgres:** Set **`DATABASE_URL`** in the Scraper-WNBA service to your Railway Postgres URL (e.g. from Railway → Postgres → Connect → “Public URL”). When set, every scraped WNBA player and their seasons/stats are written to the database (same schema as NBA: `leagues`, `seasons`, `teams`, `team_seasons`, `players`, `player_external_ids`, `player_seasons`, `player_season_stats`). Do not commit the real URL; set it only in Railway variables.

### Add WNBA league to Postgres (Railway)

If your Railway Postgres has no WNBA row in `leagues`, run this once (e.g. Railway → your Postgres service → **Data** or **Query**, then paste and run):

```sql
INSERT INTO leagues (name) VALUES ('NBA') ON CONFLICT (name) DO NOTHING;
INSERT INTO leagues (name) VALUES ('WNBA') ON CONFLICT (name) DO NOTHING;
```

Or from the repo: the same SQL is in `db/migrations/002_add_wnba_league.sql`. After this, the `leagues` table will include WNBA (and NBA if it was missing).

### Verify WNBA players in the database

- **Use the same Postgres the scraper uses:** In Railway, open the **Postgres** service that is linked to Scraper-WNBA (the one whose `DATABASE_URL` is set on the scraper). Use that service’s **Data** or **Query** tab.
- Run: `SELECT id, sr_player_id, full_name, position FROM players WHERE sr_player_id LIKE '%w' ORDER BY id DESC LIMIT 20;`  
  You should see WNBA players (IDs ending in `w`). If deploy logs show `Job N complete: xxx01w (k seasons) -> player_id=12345`, then `SELECT * FROM players WHERE id = 12345` in that same Postgres should return the row.

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

1. **Generate jobs** – Fetch all player URLs for the chosen league and enqueue them. Uses `SCRAPER_LEAGUE` (default `wnba`; use `nba` or `gleague` for NBA/G-League):

   ```bash
   npm run generate-jobs
   # Or for NBA: SCRAPER_LEAGUE=nba npm run generate-jobs
   ```

   To **clear this league's queue and refill** from the index:

   ```bash
   npm run regenerate-jobs
   # Or: SCRAPER_LEAGUE=nba npm run regenerate-jobs
   ```

   Use `regenerate-jobs` after a fresh deploy or if rosters look incomplete.

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
| `npm run regenerate-jobs` | Clear this league's jobs and enqueue full index (uses SCRAPER_LEAGUE) |
| `npm run workers`       | Run a single worker (run multiple for concurrency)        |

## Railway: player_scrape_jobs schema

The scraper expects `player_scrape_jobs` to have: **id**, **url** (or **player_url**), **league**, **status**, and retry/error columns. Workers only claim jobs where `league = SCRAPER_LEAGUE`.

1. **Run the full migration** (creates all tables): connect to your Railway Postgres and run the SQL in `db/schema.sql`, or run `npm run migrate` locally with `DATABASE_URL` set to your Railway Postgres URL.
2. **Create/fix only the jobs table**: run the SQL in `db/fix-player-scrape-jobs.sql` against your Railway Postgres (Option A creates the table; Option B adds missing columns to an existing table).

After fixing the schema, redeploy or restart the Scraper-NBA service.
