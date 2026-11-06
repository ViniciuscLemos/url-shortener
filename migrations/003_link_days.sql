-- Clicks per link per day, kept up to date with each batch of clicks. The chart of the
-- last 30 (or 90) days reads 30 small rows from here instead of counting every click,
-- so a link with a million clicks draws as fast as one with ten.
CREATE TABLE link_days (
    link_id BIGINT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
    -- the day in the timezone of the stats (São Paulo by default, TZ_STATS)
    day     DATE   NOT NULL,
    clicks  BIGINT NOT NULL,
    PRIMARY KEY (link_id, day)
);

-- the clicks that already exist
INSERT INTO link_days (link_id, day, clicks)
SELECT link_id, (clicked_at AT TIME ZONE 'America/Sao_Paulo')::date, count(*)
FROM clicks GROUP BY 1, 2;
