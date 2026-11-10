-- A link can stop on its own at a date: the Black Friday link that shouldn't keep sending
-- people to a sale that ended. After it, the link answers "gone", like one turned off.
ALTER TABLE links ADD COLUMN expires_at TIMESTAMPTZ;
