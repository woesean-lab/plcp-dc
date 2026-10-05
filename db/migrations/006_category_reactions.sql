ALTER TABLE community_stock_categories
  ADD COLUMN IF NOT EXISTS reaction_use_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS community_reaction_jobs (
  order_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  account_id TEXT,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (order_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS community_reaction_jobs_pending_idx
  ON community_reaction_jobs (status, next_attempt_at);
