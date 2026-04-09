-- Run this in Supabase Dashboard → SQL Editor if nodes add/deactivate don't persist.
-- Adds the missing "active" column so node activation state is stored.
ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
