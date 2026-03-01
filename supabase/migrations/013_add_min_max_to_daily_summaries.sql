-- Migration 013: Add per-parameter min/max columns to daily_summaries
-- These allow the Reports page to show true daily min/max bands per parameter
-- without fetching all raw sensor_readings.

ALTER TABLE daily_summaries
  ADD COLUMN IF NOT EXISTS min_temperature real,
  ADD COLUMN IF NOT EXISTS max_temperature real,
  ADD COLUMN IF NOT EXISTS min_ph real,
  ADD COLUMN IF NOT EXISTS max_ph real,
  ADD COLUMN IF NOT EXISTS min_turbidity real,
  ADD COLUMN IF NOT EXISTS max_turbidity real,
  ADD COLUMN IF NOT EXISTS min_dissolved_oxygen real,
  ADD COLUMN IF NOT EXISTS max_dissolved_oxygen real,
  ADD COLUMN IF NOT EXISTS min_flow_rate real,
  ADD COLUMN IF NOT EXISTS max_flow_rate real;
