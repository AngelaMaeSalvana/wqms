-- Track when an alert notification email was sent (for performance evaluation).
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

COMMENT ON COLUMN alerts.email_sent_at IS 'When the alert notification email was sent (client or backend).';
