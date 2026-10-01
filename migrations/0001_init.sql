-- Works you have marked: films & series, books, comics, games.
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('screen', 'book', 'comic', 'game')),
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  creators TEXT,
  summary TEXT,
  cover_key TEXT,
  cover_url TEXT,
  source TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, source_id)
);

-- One mark per item: what you think of it and when.
CREATE TABLE marks (
  item_id TEXT PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('wish', 'doing', 'done')),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  marked_on TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX marks_by_date ON marks (marked_on DESC);
CREATE INDEX items_by_kind ON items (kind);
