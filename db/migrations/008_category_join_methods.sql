ALTER TABLE community_stock_categories
  ADD COLUMN IF NOT EXISTS join_methods TEXT[] NOT NULL DEFAULT ARRAY['create_invite', 'experimental_join', 'directly']::TEXT[];

UPDATE community_stock_categories
SET join_methods = ARRAY['create_invite', 'experimental_join', 'directly']::TEXT[]
WHERE join_methods IS NULL OR CARDINALITY(join_methods) = 0;
