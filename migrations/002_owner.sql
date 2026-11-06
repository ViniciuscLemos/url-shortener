-- There are no accounts: whoever makes a link gets a secret token back, once, and the
-- browser keeps it. With it the link can point somewhere else or be turned off. Only a
-- hash is stored, so reading this table doesn't give anyone the power to change links.
ALTER TABLE links ADD COLUMN owner_token_hash BYTEA;
-- a link turned off answers "gone" instead of redirecting; its clicks stay for the numbers
ALTER TABLE links ADD COLUMN disabled_at TIMESTAMPTZ;
