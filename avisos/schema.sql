-- Avisos de Tahará: sólo se guarda a qué teléfono avisar, cuándo y con qué texto.
CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, token TEXT NOT NULL,
  endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_at ON items(at);
CREATE INDEX IF NOT EXISTS items_device ON items(device);
