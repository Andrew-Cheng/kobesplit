CREATE TABLE groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  currency TEXT NOT NULL CHECK(length(currency) = 3),
  creator_id TEXT NOT NULL REFERENCES users(id),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  currency_locked INTEGER NOT NULL DEFAULT 0 CHECK(currency_locked IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('creator','member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(group_id,user_id)
);
CREATE INDEX group_members_user ON group_members(user_id,status);
CREATE TABLE invites (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL REFERENCES groups(id),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  redeemed_by TEXT REFERENCES users(id),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX invites_group ON invites(group_id);
CREATE UNIQUE INDEX invites_pending_email ON invites(group_id,email) WHERE revoked=0 AND redeemed_by IS NULL;
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL REFERENCES groups(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  original_json TEXT,
  current_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX audit_events_group ON audit_events(group_id,created_at);
-- Successful request records contain resource IDs, never invitation tokens or emails.
CREATE TABLE write_requests (
  user_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  PRIMARY KEY(user_id,request_key)
);
CREATE TABLE write_limits (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  window INTEGER NOT NULL,
  hits INTEGER NOT NULL CHECK(hits BETWEEN 1 AND 30)
);
-- A failing CHECK aborts the entire D1 batch, including its financial/membership writes.
CREATE TABLE mutation_guards (id TEXT PRIMARY KEY, allowed INTEGER NOT NULL CHECK(allowed=1));
