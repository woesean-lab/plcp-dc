CREATE TABLE IF NOT EXISTS community_stock_categories (
  guild_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_periodic BOOLEAN NOT NULL DEFAULT FALSE,
  duration_months INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, id),
  CONSTRAINT community_stock_categories_duration_check CHECK (
    (is_periodic = FALSE AND duration_months IS NULL)
    OR (is_periodic = TRUE AND duration_months BETWEEN 1 AND 6)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS community_stock_categories_guild_name_idx
  ON community_stock_categories (guild_id, LOWER(name));
