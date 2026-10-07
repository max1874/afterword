-- Accounts: people sign in with passkeys, join by invite, and each keeps
-- their own marks. Items stay a shared catalog.
PRAGMA defer_foreign_keys = true;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- WebAuthn credentials. `id` is the credential id (base64url).
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX passkeys_by_user ON passkeys (user_id);

-- Server-side sessions so devices can be listed and signed out. `id` is the
-- SHA-256 of the cookie token, so a database read does not leak sessions.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_by_user ON sessions (user_id);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  used_at TEXT
);

-- Pending WebAuthn ceremonies. A challenge is taken (deleted) by the verify
-- step, so it works once, and expires after ten minutes.
CREATE TABLE ceremonies (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- One-time codes for signing in without a passkey, stored as SHA-256.
CREATE TABLE recovery_codes (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  PRIMARY KEY (user_id, code_hash)
);

-- The first admin. Existing marks belong to them; they pick a handle and
-- register a passkey at /setup, proving ownership with OWNER_PASSWORD.
INSERT INTO users (id, handle, name, is_admin) VALUES ('owner', 'owner', 'owner', 1);

-- Marks move from one per item to one per person and item.
CREATE TABLE marks_new (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('wish', 'doing', 'done')),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  marked_on TEXT NOT NULL,
  marked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
);
INSERT INTO marks_new (user_id, item_id, status, rating, comment, marked_on, marked_at, updated_at)
  SELECT 'owner', item_id, status, rating, comment, marked_on, marked_at, updated_at FROM marks;
DROP TABLE marks;
ALTER TABLE marks_new RENAME TO marks;
CREATE INDEX marks_by_date ON marks (user_id, marked_on DESC, marked_at DESC);
CREATE INDEX marks_by_item ON marks (item_id);

-- Who added an item by hand, so only they can remove it from the catalog.
ALTER TABLE items ADD COLUMN created_by TEXT REFERENCES users (id) ON DELETE SET NULL;
UPDATE items SET created_by = 'owner' WHERE source = 'manual';
