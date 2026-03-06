# Scraper-NBA

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

| Command              | Description                          |
|----------------------|--------------------------------------|
| `npm run migrate`    | Apply schema (creates tables if missing) |
| `npm run generate-jobs` | Enqueue all player URLs from index   |
| `npm run workers`    | Run a single worker (run multiple for concurrency) |
