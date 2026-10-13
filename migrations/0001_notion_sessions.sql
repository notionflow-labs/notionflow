CREATE TABLE IF NOT EXISTS notion_sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('state','session')),
  value TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notion_sessions_expiry ON notion_sessions(expires);
