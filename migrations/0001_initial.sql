CREATE TABLE guilds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  joined_at INTEGER NOT NULL
);
CREATE TABLE settings (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id),
  config TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TABLE access_grants (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guilds(id),
  role TEXT NOT NULL CHECK(role IN ('admin','reviewer')),
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, guild_id)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar TEXT,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE oauth_states (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE secrets (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id),
  encrypted_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id),
  message_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  probability REAL NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  ai_status TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  reviewed_by TEXT,
  review_note TEXT
);
CREATE INDEX incidents_guild_time ON incidents(guild_id, created_at DESC);
CREATE INDEX incidents_expiry ON incidents(expires_at);
CREATE TABLE strikes (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(guild_id, user_id)
);
CREATE TABLE usage_daily (
  guild_id TEXT NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(guild_id, day)
);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  guild_id TEXT,
  event TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_guild_time ON audit_log(guild_id, created_at DESC);
CREATE TABLE usage_minute (
  guild_id TEXT NOT NULL,
  minute INTEGER NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(guild_id, minute)
);
