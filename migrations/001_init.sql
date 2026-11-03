CREATE TABLE links (
    id         BIGSERIAL PRIMARY KEY,
    -- always lower case: people type links by hand and "Promo" and "promo" should be the same
    code       TEXT        NOT NULL UNIQUE CHECK (code = lower(code)),
    url        TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- kept up to date with every batch of clicks, so the total never needs a COUNT(*)
    clicks     BIGINT      NOT NULL DEFAULT 0
);

CREATE TABLE clicks (
    id         BIGSERIAL PRIMARY KEY,
    link_id    BIGINT      NOT NULL REFERENCES links (id) ON DELETE CASCADE,
    clicked_at TIMESTAMPTZ NOT NULL,
    referrer   TEXT,
    device     TEXT        NOT NULL,
    browser    TEXT        NOT NULL
);

-- every stats query is "this link, in this time window"
CREATE INDEX clicks_link_time ON clicks (link_id, clicked_at);
