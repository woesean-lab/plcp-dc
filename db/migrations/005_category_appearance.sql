ALTER TABLE community_stock_categories
  ADD COLUMN IF NOT EXISTS icon_name TEXT;

ALTER TABLE community_stock_categories
  ADD COLUMN IF NOT EXISTS color_key TEXT;

UPDATE community_stock_categories
SET icon_name = CASE WHEN id = 'online' THEN 'Timer' ELSE 'Users' END
WHERE icon_name IS NULL OR BTRIM(icon_name) = '';

UPDATE community_stock_categories
SET color_key = CASE WHEN id = 'offline' THEN 'emerald' ELSE 'violet' END
WHERE color_key IS NULL OR BTRIM(color_key) = '';

ALTER TABLE community_stock_categories
  ALTER COLUMN icon_name SET DEFAULT 'Users',
  ALTER COLUMN icon_name SET NOT NULL,
  ALTER COLUMN color_key SET DEFAULT 'violet',
  ALTER COLUMN color_key SET NOT NULL;
