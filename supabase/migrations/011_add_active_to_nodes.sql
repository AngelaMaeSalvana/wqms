-- Add active column to nodes table to persist deactivation state
ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
