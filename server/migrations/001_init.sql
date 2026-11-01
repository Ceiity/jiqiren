-- 奶龙云盘 initial schema

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nickname      TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  quota_bytes   INTEGER NOT NULL DEFAULT 0,          -- 0 = unlimited
  used_bytes    INTEGER NOT NULL DEFAULT 0,
  avatar_version INTEGER NOT NULL DEFAULT 0,          -- 0 = no avatar
  preferences   TEXT    NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,                     -- sha256(token)
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT    NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE folders (
  id          TEXT    PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   TEXT    REFERENCES folders(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  path        TEXT    NOT NULL,                       -- materialized '/<ancestor ids>/<id>/'
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  trash_batch TEXT,
  trash_root  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_folders_name ON folders(owner_id, COALESCE(parent_id, ''), name COLLATE NOCASE) WHERE deleted_at IS NULL;
CREATE INDEX idx_folders_parent ON folders(owner_id, parent_id, deleted_at);
CREATE INDEX idx_folders_path ON folders(path);
CREATE INDEX idx_folders_trash ON folders(owner_id, trash_root, deleted_at);

CREATE TABLE blobs (
  id          TEXT    PRIMARY KEY,
  hash        TEXT    NOT NULL,                       -- sha256 hex
  size        INTEGER NOT NULL,
  storage_key TEXT    NOT NULL,
  ref_count   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_blobs_hash ON blobs(hash, size);

CREATE TABLE files (
  id          TEXT    PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id   TEXT    REFERENCES folders(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  ext         TEXT    NOT NULL DEFAULT '',
  mime        TEXT    NOT NULL,
  category    TEXT    NOT NULL,                       -- image|video|audio|document|archive|other
  size        INTEGER NOT NULL,
  blob_id     TEXT    NOT NULL REFERENCES blobs(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  trash_batch TEXT,
  trash_root  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_files_name ON files(owner_id, COALESCE(folder_id, ''), name COLLATE NOCASE) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_folder ON files(owner_id, folder_id, deleted_at);
CREATE INDEX idx_files_category ON files(owner_id, category, deleted_at, updated_at);
CREATE INDEX idx_files_updated ON files(owner_id, deleted_at, updated_at);
CREATE INDEX idx_files_blob ON files(blob_id);
CREATE INDEX idx_files_trash ON files(owner_id, trash_root, deleted_at);
CREATE INDEX idx_files_size ON files(owner_id, deleted_at, size);

-- substring search over file names (trigram FTS, external content)
CREATE VIRTUAL TABLE files_fts USING fts5(name, content='files', content_rowid='rowid', tokenize='trigram');
CREATE TRIGGER files_ai AFTER INSERT ON files BEGIN
  INSERT INTO files_fts(rowid, name) VALUES (new.rowid, new.name);
END;
CREATE TRIGGER files_ad AFTER DELETE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
END;
CREATE TRIGGER files_au AFTER UPDATE OF name ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
  INSERT INTO files_fts(rowid, name) VALUES (new.rowid, new.name);
END;

CREATE TABLE upload_sessions (
  id            TEXT    PRIMARY KEY,
  owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id     TEXT,
  relative_path TEXT    NOT NULL DEFAULT '',
  name          TEXT    NOT NULL,
  size          INTEGER NOT NULL,
  received      INTEGER NOT NULL DEFAULT 0,
  mime          TEXT,
  fingerprint   TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'completing', 'done', 'canceled', 'failed')),
  temp_key      TEXT    NOT NULL,
  file_id       TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX idx_uploads_owner ON upload_sessions(owner_id, status);
CREATE INDEX idx_uploads_fp ON upload_sessions(owner_id, fingerprint, status);
CREATE INDEX idx_uploads_expires ON upload_sessions(status, expires_at);

CREATE TABLE shares (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  token            TEXT    NOT NULL UNIQUE,
  owner_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type      TEXT    NOT NULL CHECK (target_type IN ('file', 'folder')),
  target_id        TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  note             TEXT    NOT NULL DEFAULT '',
  password_hash    TEXT,
  password_version INTEGER NOT NULL DEFAULT 0,
  allow_download   INTEGER NOT NULL DEFAULT 1,
  allow_preview    INTEGER NOT NULL DEFAULT 1,
  max_downloads    INTEGER,
  max_views        INTEGER,
  view_count       INTEGER NOT NULL DEFAULT 0,
  download_count   INTEGER NOT NULL DEFAULT 0,
  expires_at       INTEGER,
  status           TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  last_access_at   INTEGER
);
CREATE INDEX idx_shares_owner ON shares(owner_id, created_at);
CREATE INDEX idx_shares_target ON shares(target_type, target_id);

CREATE TABLE share_grants (
  id               TEXT    PRIMARY KEY,               -- sha256(grant token)
  share_id         INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  password_version INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);
CREATE INDEX idx_share_grants_share ON share_grants(share_id);

CREATE TABLE share_access_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id   INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  action     TEXT    NOT NULL,                         -- view|download|unlock|unlock_failed|denied
  file_id    TEXT,
  ip         TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_share_logs_share ON share_access_logs(share_id, created_at);

CREATE TABLE download_tickets (
  id         TEXT    PRIMARY KEY,                      -- sha256(ticket)
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE system_settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE operation_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  username   TEXT,
  action     TEXT    NOT NULL,
  target     TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_oplogs_created ON operation_logs(created_at);
CREATE INDEX idx_oplogs_action ON operation_logs(action, created_at);
