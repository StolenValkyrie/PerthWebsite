CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  minutes INTEGER
);
CREATE INDEX IF NOT EXISTS idx_actions_target ON actions(target_id);