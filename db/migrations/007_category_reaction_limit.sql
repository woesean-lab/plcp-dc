ALTER TABLE community_stock_categories
  ADD COLUMN IF NOT EXISTS reaction_limit INTEGER NOT NULL DEFAULT 5;

UPDATE community_stock_categories
SET reaction_limit = 5
WHERE reaction_limit IS NULL OR reaction_limit < 1 OR reaction_limit > 1000;
