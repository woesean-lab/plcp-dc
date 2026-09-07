ALTER TABLE community_stock_categories
  DROP CONSTRAINT IF EXISTS community_stock_categories_duration_check;

ALTER TABLE community_stock_categories
  DROP COLUMN IF EXISTS duration_months;
