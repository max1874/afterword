-- When a mark was made, to order marks within the same day (newest first).
ALTER TABLE marks ADD COLUMN marked_at TEXT;
UPDATE marks SET marked_at = updated_at WHERE marked_at IS NULL;

DROP INDEX marks_by_date;
CREATE INDEX marks_by_date ON marks (marked_on DESC, marked_at DESC);
