# SpendGuard -- Technical Architecture

> System design, database schema, service architecture, and data flow.
> Version 1.0 | April 2026

---

## 1. System Overview

```
+-------------------+       +-------------------+       +-------------------+
|                   |       |                   |       |                   |
|  React Frontend   | <---> |  Node.js Backend  | <---> |    Supabase       |
|  (Vite + Tailwind)|       |  (Express + Cron) |       |  (PostgreSQL +    |
|                   |       |                   |       |   Auth + RLS)     |
+-------------------+       +-------------------+       +-------------------+
        |                          |                           |
        |                          v                           |
        |                   +-------------+                    |
        |                   |  Meta Ads   |                    |
        |                   |  API v19    |                    |
        |                   +-------------+                    |
        |                          |                           |
        |                          v                           |
        |                   +-------------+                    |
        |                   |  SendGrid   |                    |
        |                   |  (Email)    |                    |
        |                   +-------------+                    |
        |                                                      |
        +---------- Direct Supabase queries (RLS) ------------+
```

### Service Responsibilities

| Service | Role | Runtime |
|---|---|---|
| **Frontend** | React SPA. All user interaction. Queries Supabase directly (with RLS). Calls backend for Meta/invite/admin operations. | Vite dev server / static hosting |
| **Backend (cron-worker)** | Express API server + embedded cron. Handles invites, ad account linking, entity sync, rule evaluation, email alerts. | Node.js on Railway |
| **Supabase** | PostgreSQL database, Auth, Row Level Security, Edge Functions (legacy, mostly replaced by backend). | Supabase Cloud |

## 2. Database Schema

### 2.1 Tables

#### workspaces
```sql
workspaces (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notification_email VARCHAR(255),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW()
)
-- 1:1 user enforcement
CREATE UNIQUE INDEX idx_workspace_user ON workspaces(user_id)
  WHERE user_id IS NOT NULL;
```

#### workspace_ad_accounts
```sql
workspace_ad_accounts (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  ad_account_id   VARCHAR(50) NOT NULL,    -- Meta format: act_XXXXXXXXX
  account_name    VARCHAR(100),
  access_token    TEXT NOT NULL,            -- Meta System User token
  is_active       BOOLEAN DEFAULT TRUE,
  linked_at       TIMESTAMP DEFAULT NOW()
)
```

#### user_profiles
```sql
user_profiles (
  id              UUID REFERENCES auth.users(id) PRIMARY KEY,
  role            VARCHAR(20) NOT NULL DEFAULT 'workspace_user',
                  -- 'super_admin' | 'workspace_user'
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT NOW(),
  last_login_at   TIMESTAMP
)
```

#### invitations
```sql
invitations (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  email           VARCHAR(255) NOT NULL,
  token           TEXT UNIQUE NOT NULL,    -- signed JWT, 24h expiry
  sent_at         TIMESTAMP DEFAULT NOW(),
  accepted_at     TIMESTAMP,
  revoked         BOOLEAN DEFAULT FALSE
)
```

#### entity_cache
```sql
entity_cache (
  entity_id       VARCHAR(50) PRIMARY KEY,
  entity_type     VARCHAR(20) NOT NULL,     -- 'campaign' | 'adset' | 'ad'
  parent_id       VARCHAR(50),
  ad_account_id   VARCHAR(50) NOT NULL,
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  name            VARCHAR(200),
  status          VARCHAR(50),
  daily_budget    NUMERIC,
  lifetime_budget NUMERIC,
  budget_type     VARCHAR(20),              -- 'daily' | 'lifetime'
  budget_source   VARCHAR(20),              -- 'campaign' | 'adset'
  campaign_budget_opt BOOLEAN DEFAULT FALSE,
  objective       VARCHAR(100),
  meta_created_time TIMESTAMP,
  budget_change_count INTEGER DEFAULT 0,
  last_budget_changed_at TIMESTAMP,
  last_synced_at  TIMESTAMP DEFAULT NOW()
)
```

#### validation_rules
```sql
validation_rules (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  ad_account_id   VARCHAR(50) NOT NULL,
  entity_type     VARCHAR(20) NOT NULL,
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
)

CREATE INDEX idx_rules_workspace ON validation_rules(workspace_id);
CREATE INDEX idx_rules_entity    ON validation_rules(entity_id);
```

#### alert_log
```sql
alert_log (
  id                SERIAL PRIMARY KEY,
  workspace_id      INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
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
)

CREATE INDEX idx_alert_workspace ON alert_log(workspace_id);
CREATE INDEX idx_alert_active    ON alert_log(rule_id) WHERE resolved_at IS NULL;
```

#### rule_audit_log
```sql
rule_audit_log (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id         INTEGER REFERENCES validation_rules(id) ON DELETE SET NULL,
  action          VARCHAR(20) NOT NULL,
  changed_by      UUID REFERENCES auth.users(id),
  changed_at      TIMESTAMP DEFAULT NOW(),
  previous_value  JSONB,
  new_value       JSONB
)
```

Populated automatically by database trigger `trg_rule_audit` on
INSERT/UPDATE/DELETE of `validation_rules`. Action is auto-detected:
- INSERT -> `created`
- UPDATE on `active` field -> `toggled`
- UPDATE on `snooze_until` field -> `snoozed`
- Other UPDATE -> `updated`
- DELETE -> `deleted`

#### cron_run_log
```sql
cron_run_log (
  id                SERIAL PRIMARY KEY,
  started_at        TIMESTAMP DEFAULT NOW(),
  finished_at       TIMESTAMP,
  workspaces_processed INTEGER DEFAULT 0,
  rules_evaluated   INTEGER DEFAULT 0,
  violations_found  INTEGER DEFAULT 0,
  new_violations    INTEGER DEFAULT 0,
  emails_sent       INTEGER DEFAULT 0,
  errors            JSONB,
  status            VARCHAR(20) DEFAULT 'running'
)
```

### 2.2 RLS Policies

RLS is enabled on all tables except `cron_run_log`.

Helper functions:
```sql
CREATE FUNCTION my_workspace_id() RETURNS INTEGER AS $$
  SELECT workspace_id FROM user_profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE FUNCTION is_super_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

Policy pattern (applied to all RLS-enabled tables):
```sql
CREATE POLICY "{table}_isolation" ON {table}
  FOR ALL USING (
    workspace_id = my_workspace_id()
    OR is_super_admin()
  );
```

The cron worker uses the `service_role` key which bypasses RLS entirely.

## 3. Backend Architecture

### 3.1 File Structure

```
cron-worker/
  src/
    index.js              -- Registers node-cron schedule, calls runJob
    server.js             -- Express API server (invites, linking, sync, etc.)
    runJob.js             -- 8-step cron orchestration
    evaluator.js          -- Rule evaluation logic (5 metric types)
    meta/
      batchFetch.js       -- Meta Batch API wrapper (50 per call)
      entitySync.js       -- Refresh entity_cache from Meta
    db/
      supabaseClient.js   -- Supabase client (service_role key)
      queries.js          -- All DB reads/writes
    email/
      sender.js           -- SendGrid wrapper
      alertTemplate.js    -- HTML alert email builder
    config/
      index.js            -- Environment variable loader
```

### 3.2 API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/send-invite` | Super admin | Generate invite token, send email |
| POST | `/accept-invite` | Public | Verify token, create user, link workspace |
| POST | `/remove-user` | Super admin | Delete auth user, clear workspace.user_id |
| POST | `/link-ad-account` | Super admin | Link Meta ad account to workspace (with cross-workspace uniqueness check) |
| POST | `/refresh-entity-cache` | Authenticated | Trigger cache refresh for one ad account |
| POST | `/run-job` | Super admin | Manually trigger cron evaluation job |
| GET | `/ad-accounts` | Super admin | Fetch all accessible Meta ad accounts |
| GET | `/validate-entity` | Authenticated | Check entity_id exists in cache |
| GET | `/health` | Public | Health check |

### 3.3 Cron Job Flow

```
STEP 0: Insert cron_run_log row (status='running')

STEP 1: Refresh entity cache
  For each active workspace_ad_account:
    Fetch ACTIVE campaigns/adsets/ads from Meta
    UPSERT into entity_cache
    Purge entities not refreshed (no longer active)

STEP 1.5: Global stale purge (30-day safety net)

STEP 2: Load active rules
  JOIN validation_rules + workspace_ad_accounts + workspaces
  Filter: active=true, not snoozed, workspace active, account active

STEP 3: Batch-fetch metrics from Meta
  Group rules by ad_account_id
  Meta Batch API (max 50 per call)
  Fields: status, effective_status, daily_budget, lifetime_budget,
          campaign_budget_optimization, insights.date_preset(yesterday){spend}

STEP 4: Evaluate rules
  For each rule: evaluate(rule, metrics, entity, db)
  Returns violation object or null

STEP 5: Deduplicate
  For each violation:
    If no existing active alert -> INSERT alert_log (NEW violation)
    If existing active alert -> UPDATE last_alerted_at

STEP 6: Resolve cleared
  UPDATE alert_log SET resolved_at = NOW()
  WHERE resolved_at IS NULL
  AND rule_id NOT IN (currently violating rule IDs)

STEP 7: Send alert emails
  Group new violations by notification_email
  Build HTML email per recipient
  Send via SendGrid

STEP 8: Update cron_run_log (status='completed', stats)
```

### 3.4 Evaluator Logic

```
evaluate(rule, metrics, entity, db):

  campaign_objective:
    Compare entity.objective with rule.threshold
    Operators: equals_string, not_equals_string

  budget_level:
    Compare entity.budget_source with rule.threshold
    Operators: equals_string, not_equals_string

  budget_type:
    Compare entity.budget_type with rule.threshold
    Operators: equals_string, not_equals_string

  budget_threshold:
    Parse threshold: "daily:5000" or "lifetime_remaining:10000"
    For daily: compare entity.daily_budget
    For lifetime_remaining: compute entity.lifetime_budget - metrics.spend
    CBO-aware: skip adset rules if campaign uses CBO
    Operators: <, >, =

  budget_change_frequency_monthly:
    Use entity.budget_change_count (resets monthly)
    Operators: <, >, =
```

### 3.5 Entity Sync Logic

```
syncEntityCache(adAccountId, accessToken, workspaceId):

  1. Fetch existing entity_cache rows (for budget change tracking)
  2. Fetch ACTIVE campaigns from Meta (filtered by effective_status)
  3. Build CBO lookup map (campaign_id -> isCBO)
  4. Parse campaign budgets (Meta returns cents -> divide by 100)
  5. Compute budget_change_count (compare old vs new budget; reset monthly)
  6. Fetch ACTIVE adsets (CBO determined by parent campaign flag)
  7. Fetch ACTIVE ads
  8. UPSERT all entities
  9. Purge entities not refreshed in this sync (inactive on Meta)
```

## 4. Frontend Architecture

### 4.1 File Structure

```
frontend/src/
  App.jsx                       -- Route definitions
  main.jsx                      -- React entry point
  index.css                     -- Tailwind + utility classes
  lib/
    supabase.js                 -- Supabase client init
    api.js                      -- All API functions (Supabase queries + backend calls)
    auth.js                     -- Auth helpers
    AuthContext.jsx              -- Auth state provider
  components/
    PrivateRoute.jsx            -- Role-based route guard
    layout/AppShell.jsx         -- Sidebar + topbar layout
    EntityPicker.jsx            -- Drill-down: account -> campaign -> adset
    NavBar.jsx                  -- Legacy nav (replaced by AppShell)
  pages/
    Login.jsx                   -- Email/password login
    AcceptInvite.jsx            -- Invite token acceptance + password set
    admin/
      Dashboard.jsx             -- Overview with Rules & Violations table
      Workspaces.jsx            -- Workspace list
      WorkspaceDetail.jsx       -- 3 tabs: Campaigns & Rules, Alerts, Settings
      AllRules.jsx              -- Flat rule list with filters + inline actions
      AllAlerts.jsx             -- All violations across workspaces
      AdminActivity.jsx         -- Audit log + sync runs
      AdminSettings.jsx         -- Platform settings
    workspace/
      Dashboard.jsx             -- Violations + rule health
      CampaignsView.jsx         -- Campaign tree + rule creation + filter
      RulesManager.jsx          -- Full rule CRUD with entity picker
      ActivityLog.jsx           -- Alert history
      AlertSettings.jsx         -- Notification email + account info
```

### 4.2 Auth Flow

```
Login:
  1. supabase.auth.signInWithPassword(email, password)
  2. Fetch user_profiles for role + workspace_id
  3. Redirect: super_admin -> /admin, workspace_user -> /workspace

Invite:
  1. Super admin POST /send-invite (generates JWT, sends email)
  2. User clicks link -> /accept-invite?token=XYZ
  3. User sets password -> POST /accept-invite
  4. Backend: verify JWT, create auth user, insert user_profiles,
     link workspace, mark invite accepted, return session
  5. Frontend: set session, redirect to /workspace

Route Protection:
  PrivateRoute checks:
  - Is user authenticated? (redirect to /login if not)
  - Does role match requiredRole? (redirect to correct portal if not)
  - Wraps children in AppShell (sidebar layout)
```

### 4.3 Data Caching

| Data | Cache | TTL | Invalidation |
|---|---|---|---|
| Ad accounts list | sessionStorage | 30 min | Manual refresh (bust=true) |
| Campaigns view | sessionStorage | 10 min | Manual refresh, rule save |
| Auth session | Supabase Auth | Auto-refresh | Logout |

## 5. Meta API Integration

### 5.1 Batch API Pattern

```javascript
// Group entity IDs into chunks of 50
// For each chunk, build batch request:
const batch = entityIds.map(id => ({
  method: 'GET',
  relative_url: `${id}?fields=${ENTITY_FIELDS}`
}))

// Single HTTP POST with all requests:
POST https://graph.facebook.com/v19.0/
Body: { batch: JSON.stringify(batch), access_token }
```

### 5.2 Fields Fetched

**Entity sync (campaigns):**
id, name, status, effective_status, objective, daily_budget, lifetime_budget,
budget_remaining, budget_optimization_type, campaign_budget_optimization,
created_time

**Entity sync (adsets):**
id, name, status, effective_status, daily_budget, lifetime_budget,
budget_remaining, campaign_id, created_time

**Cron evaluation (batch fetch):**
id, name, status, effective_status, daily_budget, lifetime_budget,
budget_remaining, campaign_budget_optimization,
insights.date_preset(yesterday){spend}

### 5.3 Rate Limits

Meta allows ~200 calls/hour per token. With Batch API (50 per call), this is
effectively 10,000 entity fetches/hour per token.

## 6. Email System

### SendGrid Integration

- Alert emails sent via SendGrid HTTP API
- `EMAIL_FROM` configured in environment
- Violations grouped by `notification_email` (one email per recipient)
- Each email contains a table of all violations for that workspace
- Includes a link to the workspace portal

### Email Template Structure

```
Subject: SpendGuard Alert -- {count} new violation(s)

Body:
  Header: "Campaign Alert" description
  For each ad_account:
    Account name heading
    Table: Entity | Type | Alert Name | Rule | Actual Value
  Footer: Link to workspace portal
```

## 7. Environment Variables

### Backend (cron-worker/.env)

| Variable | Required | Description |
|---|---|---|
| SUPABASE_URL | Yes | Supabase project URL |
| SUPABASE_SERVICE_ROLE_KEY | Yes | Service role key (bypasses RLS) |
| SENDGRID_API_KEY | Yes | SendGrid API key for email |
| EMAIL_FROM | Yes | Sender email address |
| FRONTEND_URL | No | Portal URL for email links (default: http://localhost:5173) |
| CRON_SCHEDULE | No | Cron expression (default: 0 */6 * * *) |
| JWT_INVITE_SECRET | Yes | Secret for signing invite JWTs |
| SYSTEM_USER_TOKEN | No | Meta System User token for all API calls |
| PORT | No | API server port (default: 3001) |

### Frontend (frontend/.env)

| Variable | Required | Description |
|---|---|---|
| VITE_SUPABASE_URL | Yes | Supabase project URL |
| VITE_SUPABASE_ANON_KEY | Yes | Supabase anon key (RLS-protected) |
| VITE_API_URL | No | Backend API URL (default: http://localhost:3001) |

## 8. Dependencies

### Frontend

| Package | Version | Purpose |
|---|---|---|
| react | ^18.3.1 | UI framework |
| react-dom | ^18.3.1 | React DOM renderer |
| react-router-dom | ^6.23.1 | Client-side routing |
| @supabase/supabase-js | ^2.43.0 | Supabase client |
| tailwindcss | ^3.4.19 | Utility-first CSS |
| vite | ^5.2.12 | Build tool |

### Backend

| Package | Version | Purpose |
|---|---|---|
| express | ^5.2.1 | HTTP server |
| @supabase/supabase-js | ^2.43.0 | Supabase client (service role) |
| axios | ^1.7.2 | Meta API HTTP calls |
| node-cron | ^3.0.3 | Cron scheduler |
| @sendgrid/mail | ^8.1.3 | Email delivery |
| jose | ^6.2.2 | JWT signing/verification for invites |
| dotenv | ^16.4.5 | Environment variable loading |
| cors | ^2.8.6 | CORS middleware |
