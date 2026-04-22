-- ============================================================
-- SpendGuard — Initial Schema
-- Run this in your Supabase SQL editor (or via supabase db push)
-- ============================================================

-- ============================================================
-- CONFIG LAYER
-- ============================================================

CREATE TABLE IF NOT EXISTS workspaces (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(100) NOT NULL,
  client_name         VARCHAR(100) NOT NULL,
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notification_email  VARCHAR(255),
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMP DEFAULT NOW()
);

-- Enforce 1 user ↔ 1 workspace at DB level
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_user
  ON workspaces(user_id)
  WHERE user_id IS NOT NULL;

-- NOTE: workspace_ad_accounts stores access_token via Supabase Vault.
-- The access_token column below holds the Vault secret ID (uuid), not the raw token.
-- Use supabase.vault.create_secret() when inserting, vault.decrypted_secrets when reading in cron worker.
CREATE TABLE IF NOT EXISTS workspace_ad_accounts (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ad_account_id   VARCHAR(50) NOT NULL,
  account_name    VARCHAR(100),
  access_token    TEXT NOT NULL,   -- Vault secret ID
  is_active       BOOLEAN DEFAULT TRUE,
  linked_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id            UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role          VARCHAR(20) NOT NULL DEFAULT 'workspace_user'
                  CHECK (role IN ('super_admin', 'workspace_user')),
  workspace_id  INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at    TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invitations (
  id            SERIAL PRIMARY KEY,
  workspace_id  INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         VARCHAR(255) NOT NULL,
  token         TEXT UNIQUE NOT NULL,
  sent_at       TIMESTAMP DEFAULT NOW(),
  accepted_at   TIMESTAMP,
  revoked       BOOLEAN DEFAULT FALSE
);

-- ============================================================
-- ENTITY CACHE
-- ============================================================

CREATE TABLE IF NOT EXISTS entity_cache (
  entity_id       VARCHAR(50) PRIMARY KEY,
  entity_type     VARCHAR(20) NOT NULL CHECK (entity_type IN ('campaign', 'adset', 'ad')),
  parent_id       VARCHAR(50),
  ad_account_id   VARCHAR(50) NOT NULL,
  workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            VARCHAR(200),
  status          VARCHAR(50),
  daily_budget    NUMERIC,
  objective       VARCHAR(100),
  last_synced_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_cache_workspace ON entity_cache(workspace_id);
CREATE INDEX IF NOT EXISTS idx_entity_cache_account   ON entity_cache(ad_account_id);

-- ============================================================
-- VALIDATION RULES
-- ============================================================

CREATE TABLE IF NOT EXISTS validation_rules (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ad_account_id   VARCHAR(50) NOT NULL,
  entity_type     VARCHAR(20) NOT NULL CHECK (entity_type IN ('campaign', 'adset', 'ad')),
  entity_id       VARCHAR(50) NOT NULL,
  entity_name     VARCHAR(200),
  metric          VARCHAR(50) NOT NULL,
  operator        VARCHAR(20) NOT NULL,
  threshold       VARCHAR(100) NOT NULL,
  active          BOOLEAN DEFAULT TRUE,
  alert_name      VARCHAR(200),
  snooze_until    TIMESTAMP,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rules_workspace ON validation_rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_rules_entity    ON validation_rules(entity_id);

-- ============================================================
-- LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS alert_log (
  id                SERIAL PRIMARY KEY,
  workspace_id      INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id           INTEGER REFERENCES validation_rules(id) ON DELETE SET NULL,
  entity_id         VARCHAR(50) NOT NULL,
  entity_name       VARCHAR(200),
  metric            VARCHAR(50) NOT NULL,
  operator          VARCHAR(20) NOT NULL,
  threshold         VARCHAR(100) NOT NULL,
  actual_value      VARCHAR(100) NOT NULL,
  first_alerted_at  TIMESTAMP DEFAULT NOW(),
  last_alerted_at   TIMESTAMP DEFAULT NOW(),
  resolved_at       TIMESTAMP,
  notified          BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_alert_workspace ON alert_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_alert_active    ON alert_log(rule_id) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS rule_audit_log (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id         INTEGER REFERENCES validation_rules(id) ON DELETE SET NULL,
  action          VARCHAR(20) NOT NULL
                    CHECK (action IN ('created', 'updated', 'deleted', 'toggled', 'snoozed')),
  changed_by      UUID REFERENCES auth.users(id),
  changed_at      TIMESTAMP DEFAULT NOW(),
  previous_value  JSONB,
  new_value       JSONB
);

-- cron_run_log: no RLS — backend-only (service_role key bypasses RLS anyway)
CREATE TABLE IF NOT EXISTS cron_run_log (
  id                    SERIAL PRIMARY KEY,
  started_at            TIMESTAMP DEFAULT NOW(),
  finished_at           TIMESTAMP,
  workspaces_processed  INTEGER DEFAULT 0,
  rules_evaluated       INTEGER DEFAULT 0,
  violations_found      INTEGER DEFAULT 0,
  new_violations        INTEGER DEFAULT 0,
  emails_sent           INTEGER DEFAULT 0,
  errors                JSONB,
  status                VARCHAR(20) DEFAULT 'running'
                          CHECK (status IN ('running', 'completed', 'failed'))
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE workspaces           ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_cache         ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_audit_log       ENABLE ROW LEVEL SECURITY;

-- Helper: is current user a super admin?
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  )
$$;

-- Helper: get workspace_id for current user
CREATE OR REPLACE FUNCTION my_workspace_id()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$
  SELECT workspace_id FROM user_profiles WHERE id = auth.uid()
$$;

-- workspaces
CREATE POLICY "workspaces: own or super_admin" ON workspaces
  FOR ALL USING (
    user_id = auth.uid()
    OR is_super_admin()
  );

-- workspace_ad_accounts
CREATE POLICY "ad_accounts: own workspace or super_admin" ON workspace_ad_accounts
  FOR ALL USING (
    workspace_id = my_workspace_id()
    OR is_super_admin()
  );

-- user_profiles: each user sees only their own row; super_admin sees all
CREATE POLICY "user_profiles: own or super_admin" ON user_profiles
  FOR ALL USING (
    id = auth.uid()
    OR is_super_admin()
  );

-- invitations: super_admin only
CREATE POLICY "invitations: super_admin only" ON invitations
  FOR ALL USING (is_super_admin());

-- entity_cache
CREATE POLICY "entity_cache: own workspace or super_admin" ON entity_cache
  FOR ALL USING (
    workspace_id = my_workspace_id()
    OR is_super_admin()
  );

-- validation_rules
CREATE POLICY "rules: own workspace or super_admin" ON validation_rules
  FOR ALL USING (
    workspace_id = my_workspace_id()
    OR is_super_admin()
  );

-- alert_log
CREATE POLICY "alerts: own workspace or super_admin" ON alert_log
  FOR ALL USING (
    workspace_id = my_workspace_id()
    OR is_super_admin()
  );

-- rule_audit_log
CREATE POLICY "audit: own workspace or super_admin" ON rule_audit_log
  FOR ALL USING (
    workspace_id = my_workspace_id()
    OR is_super_admin()
  );

-- ============================================================
-- TRIGGER: auto-populate rule_audit_log on rule changes
-- ============================================================

CREATE OR REPLACE FUNCTION log_rule_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO rule_audit_log(workspace_id, rule_id, action, changed_by, new_value)
    VALUES (NEW.workspace_id, NEW.id, 'created', NEW.created_by, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    DECLARE
      action_type VARCHAR(20) := 'updated';
    BEGIN
      IF OLD.active IS DISTINCT FROM NEW.active THEN action_type := 'toggled'; END IF;
      IF OLD.snooze_until IS DISTINCT FROM NEW.snooze_until THEN action_type := 'snoozed'; END IF;
      INSERT INTO rule_audit_log(workspace_id, rule_id, action, changed_by, previous_value, new_value)
      VALUES (NEW.workspace_id, NEW.id, action_type, NEW.updated_by, to_jsonb(OLD), to_jsonb(NEW));
    END;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO rule_audit_log(workspace_id, rule_id, action, changed_by, previous_value)
    VALUES (OLD.workspace_id, OLD.id, 'deleted', OLD.updated_by, to_jsonb(OLD));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE TRIGGER trg_rule_audit
AFTER INSERT OR UPDATE OR DELETE ON validation_rules
FOR EACH ROW EXECUTE FUNCTION log_rule_change();
