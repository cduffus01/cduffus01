-- Brand Audit V0 schema (spec section 21). Applied by the postgres store driver
-- on first use; safe to run repeatedly.

CREATE TABLE IF NOT EXISTS audits (
  id            TEXT PRIMARY KEY,
  url           TEXT NOT NULL,
  domain        TEXT NOT NULL,
  audit_type    TEXT NOT NULL,
  status        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  brand_score   INTEGER,
  projected_score INTEGER,
  doc           JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS audits_domain_idx ON audits (domain);
CREATE INDEX IF NOT EXISTS audits_created_idx ON audits (created_at DESC);

-- Page, token, rule, finding, preview and profile documents are stored as
-- JSONB keyed by audit: they are read whole, always, by one consumer.
CREATE TABLE IF NOT EXISTS audit_documents (
  audit_id  TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,  -- pages | tokens | rules | findings | preview | profile
  doc       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_id, kind)
);

CREATE TABLE IF NOT EXISTS leads (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  audit_id   TEXT,
  fix_intent BOOLEAN NOT NULL DEFAULT false,
  source     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (email);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  audit_id   TEXT,
  props      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_name_idx ON events (name, created_at DESC);

-- Rate limiting: hashed origin only, never a raw IP.
CREATE TABLE IF NOT EXISTS audit_origins (
  audit_id   TEXT PRIMARY KEY,
  ip_hash    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_origins_ip_idx ON audit_origins (ip_hash, created_at DESC);
