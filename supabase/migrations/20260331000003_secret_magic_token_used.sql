-- Add magic_token_used column for single-use magic link enforcement.
-- Default false so existing rows are treated as unused.
ALTER TABLE secret_requests
  ADD COLUMN IF NOT EXISTS magic_token_used BOOLEAN NOT NULL DEFAULT false;
