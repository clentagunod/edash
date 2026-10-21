CREATE TABLE IF NOT EXISTS eduai_provider_settings (
  school_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  selected_provider TEXT NOT NULL DEFAULT 'default',
  personal_provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL DEFAULT '',
  encrypted_iv TEXT NOT NULL DEFAULT '',
  encrypted_ciphertext TEXT NOT NULL DEFAULT '',
  encrypted_tag TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (school_id, uid)
);

CREATE TABLE IF NOT EXISTS eduai_usage (
  school_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  provider TEXT NOT NULL,
  month TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, uid, provider, month)
);
