CREATE TABLE IF NOT EXISTS community_stock_categories (
  guild_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_periodic BOOLEAN NOT NULL DEFAULT FALSE,
  icon_name TEXT NOT NULL DEFAULT 'Users',
  color_key TEXT NOT NULL DEFAULT 'violet',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS community_stock_categories_guild_name_idx
  ON community_stock_categories (guild_id, LOWER(name));
