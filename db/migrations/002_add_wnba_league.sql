-- Add WNBA (and NBA if missing) to leagues so worker/jobs can use league = 'wnba'.
-- Run once against your Railway Postgres (e.g. Railway → Postgres → Data → Query, or psql).

INSERT INTO leagues (name) VALUES ('NBA') ON CONFLICT (name) DO NOTHING;
INSERT INTO leagues (name) VALUES ('WNBA') ON CONFLICT (name) DO NOTHING;
