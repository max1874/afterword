-- The works a person chose for the kind tiles on their home, as JSON by tile
-- ({"comic": "<item id>"}); tiles without a choice show the newest mark.
ALTER TABLE users ADD COLUMN tiles TEXT;
