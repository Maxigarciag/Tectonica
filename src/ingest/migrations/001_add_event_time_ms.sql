-- Migration: add event_time_ms column
-- Description: Add event_time_ms BIGINT NOT NULL with descending index for window filtering
-- Backfill from properties->>'time' (epoch milliseconds)

-- Step 1: Add column as nullable first
ALTER TABLE earthquakes ADD COLUMN IF NOT EXISTS event_time_ms BIGINT;

-- Step 2: Backfill from properties->>'time'
UPDATE earthquakes
SET event_time_ms = (properties->>'time')::BIGINT
WHERE event_time_ms IS NULL;

-- Step 3: Verify no NULLs remain
DO $$
DECLARE
    null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count FROM earthquakes WHERE event_time_ms IS NULL;
    IF null_count > 0 THEN
        RAISE EXCEPTION 'event_time_ms backfill failed: % rows still NULL', null_count;
    END IF;
END $$;

-- Step 4: Set column to NOT NULL
ALTER TABLE earthquakes ALTER COLUMN event_time_ms SET NOT NULL;

-- Step 5: Create descending index for window queries
CREATE INDEX IF NOT EXISTS idx_earthquakes_event_time_ms_desc
    ON earthquakes (event_time_ms DESC);