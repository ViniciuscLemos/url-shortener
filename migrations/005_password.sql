-- A link can ask for a password before it sends anyone on: the file for the client, the
-- form for the team. Only a scrypt hash is kept (with its salt), never the password.
ALTER TABLE links ADD COLUMN password_hash TEXT;
