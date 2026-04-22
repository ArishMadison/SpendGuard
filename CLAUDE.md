# Campaign Alert Portal — Project Context

> This file gives Claude Code full context on the system being built.
> Read this before touching any file. Every decision here was made deliberately.

---

## What this system does

A multi-tenant web portal where approved users manage validation rules against their
Meta Ads campaigns. A scheduled job runs every 6 hours, fetches live metrics from the
Meta Ads API, evaluates each rule, and sends alert emails only when a rule is breached.

The system replaces a manual Google Sheets workflow. Rules now live in a database,
managed through a portal UI, with a full audit trail of every change.

---

## Who uses it

**Super admin** — internal ops person. Creates workspaces, sends invite links to clients,
links ad accounts to workspaces, manages tokens. Cannot be self-registered.

**Workspace user** — one approved person per workspace (1:1 strict). Manages their own
validation rules, views alert history, configures notification email. Sees only their
own workspace — complete isolation.

---

## Tech stack — decisions and reasons

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite | Standard, fast to build |
| Database | Supabase (PostgreSQL) | Hosted PG + RLS + Auth + Edge Functions |
| Auth | Supabase Auth + user_profiles table | Supabase handles sessions/refresh. Custom user_profiles stores role + workspace_id. Invite flow is custom (super admin triggers it). |
| Short API logic | Supabase Edge Functions (Deno) | Invite email, accept invite, entity validation — short-lived, <2s |
| Cron job | Dedicated Node.js service on Railway | Edge Functions time out. Cron can run 5–10 min across many workspaces. Reads from Supabase, calls Meta, writes back. |
| Email | SendGrid | Invite emails + alert emails |
| Meta API | Meta Marketing API v19 + Batch API | Batch API used — up to 50 requests in one HTTP call. No on-premise DB. |

**Key architectural call: no on-premise DB, no metrics storage.**
Metrics (spend, CTR, etc.) are fetched live from Meta at cron time, evaluated in memory,
and discarded. Only violations are stored (in alert_log). This keeps Supabase lean.

---

## Cron schedule

Runs every 6 hours: `0 */6 * * *` — midnight, 06:00, 12:00, 18:00.
Always uses `date_preset=yesterday` for Meta insights — today's data is incomplete.
This means the same day's data is evaluated at all four runs. Correct by design.
Deduplication via alert_log prevents re-alerting the same active violation.

---

## Workspace model

```
1 workspace  →  1 client  →  1 user  →  N ad accounts
```

- One workspace per client. Not one workspace per ad account.
- Multiple ad accounts live inside one workspace.
- Each ad account has its own Meta System User access token stored in `workspace_ad_accounts`.
- Tokens are stored encrypted. Never returned to the frontend raw.
- Super admin sets up ad accounts and tokens when onboarding a client.
- User sees all their accounts and campaigns in one place.

---

## Supabase schema — all 8 tables

### CONFIG LAYER (permanent, never expires)

```sql
-- One row per client
workspaces (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  client_name     VARCHAR(100) NOT NULL,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notification_email VARCHAR(255),         -- where alert emails go
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW()
)

-- Unique index enforces 1 user <-> 1 workspace at DB level
CREATE UNIQUE INDEX idx_workspace_user ON workspaces(user_id)
  WHERE user_id IS NOT NULL;

-- N ad accounts per workspace, each with own Meta token
workspace_ad_accounts (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  ad_account_id   VARCHAR(50) NOT NULL,    -- Meta format: act_XXXXXXXXX
  account_name    VARCHAR(100),            -- pulled from Meta on link
  access_token    TEXT NOT NULL,           -- Meta System User token, encrypted
  is_active       BOOLEAN DEFAULT TRUE,
  linked_at       TIMESTAMP DEFAULT NOW()
)

-- Managed by Supabase Auth. Extended with this table.
user_profiles (
  id              UUID REFERENCES auth.users(id) PRIMARY KEY,
  role            VARCHAR(20) NOT NULL DEFAULT 'workspace_user',
                  -- 'super_admin' | 'workspace_user'
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT NOW(),
  last_login_at   TIMESTAMP
)

-- Single-use invite tokens. Super admin creates, user accepts.
invitations (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  email           VARCHAR(255) NOT NULL,
  token           TEXT UNIQUE NOT NULL,    -- signed JWT, 24h expiry
  sent_at         TIMESTAMP DEFAULT NOW(),
  accepted_at     TIMESTAMP,               -- NULL = not yet accepted
  revoked         BOOLEAN DEFAULT FALSE
)
```

### ENTITY CACHE (refreshed — see strategy below)

```sql
-- Campaigns, adsets, ads from Meta. One table for all types.
entity_cache (
  entity_id       VARCHAR(50) PRIMARY KEY,  -- campaign_id / adset_id / ad_id
  entity_type     VARCHAR(20) NOT NULL,     -- 'campaign' | 'adset' | 'ad'
  parent_id       VARCHAR(50),              -- campaign_id for adsets, adset_id for ads
  ad_account_id   VARCHAR(50) NOT NULL,
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  name            VARCHAR(200),
  status          VARCHAR(50),              -- ACTIVE | PAUSED | ARCHIVED | ERROR
  daily_budget    NUMERIC,
  objective       VARCHAR(100),             -- campaigns only
  last_synced_at  TIMESTAMP DEFAULT NOW()
)
```

### RULES (permanent, user-managed)

```sql
validation_rules (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  ad_account_id   VARCHAR(50) NOT NULL,
  entity_type     VARCHAR(20) NOT NULL,     -- 'campaign' | 'adset' | 'ad'
  entity_id       VARCHAR(50) NOT NULL,
  entity_name     VARCHAR(200),             -- display only, not used for querying
  metric          VARCHAR(50) NOT NULL,     -- see supported metrics below
  operator        VARCHAR(20) NOT NULL,     -- '<' | '>' | '=' | 'equals_string'
  threshold       VARCHAR(100) NOT NULL,    -- numeric or string (delivery_status)
  active          BOOLEAN DEFAULT TRUE,
  alert_name      VARCHAR(200),
  snooze_until    TIMESTAMP,                -- cron skips if snooze_until > NOW()
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
)

CREATE INDEX idx_rules_workspace ON validation_rules(workspace_id);
CREATE INDEX idx_rules_entity    ON validation_rules(entity_id);
```

### LOGS (append-only, never overwritten)

```sql
-- Every violation event. One row per breach, resolved_at set when it clears.
alert_log (
  id                SERIAL PRIMARY KEY,
  workspace_id      INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id           INTEGER REFERENCES validation_rules(id) ON DELETE SET NULL,
  entity_id         VARCHAR(50) NOT NULL,
  entity_name       VARCHAR(200),
  metric            VARCHAR(50) NOT NULL,
  operator          VARCHAR(20) NOT NULL,
  threshold         VARCHAR(100) NOT NULL,
  actual_value      VARCHAR(100) NOT NULL,  -- value at time of breach
  first_alerted_at  TIMESTAMP DEFAULT NOW(),
  last_alerted_at   TIMESTAMP DEFAULT NOW(),
  resolved_at       TIMESTAMP,              -- NULL = still active
  notified          BOOLEAN DEFAULT TRUE
)

CREATE INDEX idx_alert_workspace ON alert_log(workspace_id);
CREATE INDEX idx_alert_active    ON alert_log(rule_id) WHERE resolved_at IS NULL;

-- Every rule create/edit/delete/toggle/snooze. JSONB diff approach.
rule_audit_log (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id         INTEGER REFERENCES validation_rules(id) ON DELETE SET NULL,
  action          VARCHAR(20) NOT NULL,
                  -- 'created' | 'updated' | 'deleted' | 'toggled' | 'snoozed'
  changed_by      UUID REFERENCES auth.users(id),
  changed_at      TIMESTAMP DEFAULT NOW(),
  previous_value  JSONB,                    -- snapshot of fields before change
  new_value       JSONB                     -- snapshot of fields after change
)
-- Example: editing threshold from 1.0 to 0.8 stores:
-- previous_value: {"threshold": "1.0"}
-- new_value:      {"threshold": "0.8"}

-- One row per cron execution. Operational visibility.
cron_run_log (
  id                SERIAL PRIMARY KEY,
  started_at        TIMESTAMP DEFAULT NOW(),
  finished_at       TIMESTAMP,
  workspaces_processed INTEGER DEFAULT 0,
  rules_evaluated   INTEGER DEFAULT 0,
  violations_found  INTEGER DEFAULT 0,
  new_violations    INTEGER DEFAULT 0,
  emails_sent       INTEGER DEFAULT 0,
  errors            JSONB,                  -- array of error objects if any
  status            VARCHAR(20) DEFAULT 'running'
                    -- 'running' | 'completed' | 'failed'
)
```

---

## Supported validation metrics

| metric key | type | notes |
|---|---|---|
| `ctr` | numeric | Click-through rate |
| `spend` | numeric | Amount spent |
| `impressions` | numeric | Total impressions |
| `clicks` | numeric | Total clicks |
| `cpc` | numeric | Cost per click |
| `reach` | numeric | Unique reach |
| `frequency` | numeric | Impressions ÷ reach |
| `budget_utilisation` | numeric | Computed: (spend / daily_budget) × 100. Stored in entity_cache.daily_budget. |
| `roas` | numeric | Revenue ÷ spend |
| `cost_per_result` | numeric | Spend ÷ conversions |
| `inactive_campaign` | special | Fires if impressions = 0. Operator and threshold fields hidden in UI. |
| `delivery_status` | string | Fires if status matches threshold exactly. Operator forced to 'equals_string'. Threshold is a string: ACTIVE, PAUSED, ERROR, DISAPPROVED, etc. |

---

## Entity cache refresh strategy

Three triggers — not time-based polling:

**1. On account link (immediate)**
When super admin adds an ad account to a workspace, immediately fetch all
campaigns/adsets/ads for that account. Populate entity_cache.

**2. On demand (user-initiated)**
When user opens the rule builder, check `last_synced_at` per account.
If older than 6 hours → fetch fresh from Meta, show "Syncing..." indicator.
If recent → serve from entity_cache directly. No Meta API call.

**3. Daily (automated)**
The cron job, before evaluating rules, refreshes entity_cache for all active accounts.
Uses UPSERT (`ON CONFLICT (entity_id) DO UPDATE`) — safe to re-run, never duplicates.
This ensures names, statuses, and budgets are current at evaluation time.

**Metrics are never cached.** Fetched live at cron time, evaluated in memory, discarded.
Only actual_value in alert_log rows preserves metric values (for display in activity log).

---

## Auth flow

Supabase Auth handles sessions, token refresh, and logout.
`user_profiles` table extends Supabase Auth with role + workspace_id.

**Login:** Standard Supabase Auth email/password.
On success, read user_profiles to get role and workspace_id.
Redirect: super_admin → /admin, workspace_user → /workspace.

**Invite flow (custom):**
1. Super admin sends invite from admin panel.
2. Backend (Edge Function) generates signed JWT: `{ workspace_id, email, purpose: 'invite' }`, 24h expiry.
3. Inserts row in invitations table.
4. Sends invite email via SendGrid with link: `{FRONTEND_URL}/accept-invite?token=XYZ`
5. User clicks link → AcceptInvite page → submits `{ token, password }` to Edge Function.
6. Edge Function verifies JWT + checks invitations row (not revoked, not accepted, not expired).
7. Creates Supabase Auth user via `supabase.auth.admin.createUser()`.
8. Inserts user_profiles row with role + workspace_id.
9. Sets workspace.user_id = new user id.
10. Marks invitation accepted_at = NOW().
11. Returns session tokens. User redirected to /workspace.

**Revoke:** Super admin hits revoke endpoint.
Sets workspace.user_id = NULL. Calls `supabase.auth.admin.deleteUser()` or disables.
Workspace and its rules are preserved. Can be reassigned to a new user via re-invite.

**Reassign:** Same as revoke, then sendInvite() for new email.

---

## Rule setting flow (UI)

```
User clicks "Add rule"
  → Select ad account (from workspace's linked accounts)
  → Portal fetches campaigns from entity_cache (or live if stale)
  → User picks entity level: campaign / adset / ad
  → If adset/ad: drill down picker loads children
  → Fill in: metric (dropdown), operator (dropdown), threshold (input), alert name
  → Special handling:
      inactive_campaign  → hide operator + threshold fields
      delivery_status    → lock operator to 'equals', show text/dropdown for threshold
  → On blur of entity_id field: call /validate-entity to confirm it exists
  → Save → POST to validation_rules table
  → rule_audit_log entry created: action='created', new_value=full rule snapshot
```

---

## Cron job architecture (Node.js on Railway)

File: `cron/runJob.js`

```
STEP 0: Insert cron_run_log row, status='running'

STEP 1: Refresh entity_cache
  For each active workspace_ad_account:
    Meta Batch API → fetch all campaign/adset/ad objects
    UPSERT into entity_cache

STEP 2: Load all active rules
  SELECT vr.*, waa.access_token, waa.ad_account_id, w.notification_email
  FROM validation_rules vr
  JOIN workspace_ad_accounts waa ON vr.ad_account_id = waa.ad_account_id
  JOIN workspaces w ON vr.workspace_id = w.id
  WHERE vr.active = true
    AND (vr.snooze_until IS NULL OR vr.snooze_until < NOW())
    AND w.is_active = true
    AND waa.is_active = true

STEP 3: Group rules by ad_account_id
  Build Meta Batch API requests — max 50 per batch
  Each request: GET /{entity_id}?fields=status,insights.date_preset(yesterday){...}
  Send batches, collect results into Map<entity_id, metrics>

STEP 4: Evaluate rules
  For each rule:
    metrics = metricMap.get(rule.entity_id)
    violation = evaluate(rule, metrics)  -- see evaluator logic below
    if violation: push to violations[]

STEP 5: Deduplicate
  For each violation:
    existing = SELECT * FROM alert_log WHERE rule_id = ? AND resolved_at IS NULL
    if no existing row: INSERT into alert_log, push to newViolations[]

STEP 6: Resolve cleared rules
  violatedRuleIds = Set of all rule_ids in violations (not just new ones)
  UPDATE alert_log SET resolved_at = NOW()
  WHERE resolved_at IS NULL
  AND workspace_id IN (active workspace ids)
  AND rule_id NOT IN (violatedRuleIds)

STEP 7: Send alert emails
  if newViolations.length === 0: log "no new violations", return
  Group newViolations by workspace.notification_email
  For each email address:
    Build HTML email (violations grouped by ad account → entity)
    Send via SendGrid
    Log sent

STEP 8: Update cron_run_log row, status='completed'
```

---

## Evaluator logic

```javascript
function evaluate(rule, metrics) {
  if (!metrics) return null;

  // Special: inactive_campaign
  if (rule.metric === 'inactive_campaign') {
    if (parseInt(metrics.impressions || 0) !== 0) return null;
    return buildViolation(rule, '0', 'impressions = 0 today (campaign inactive)');
  }

  // Special: delivery_status
  if (rule.metric === 'delivery_status') {
    const actual   = (metrics.status || metrics.delivery_status || '').toUpperCase();
    const expected = (rule.threshold || '').toUpperCase();
    if (actual !== expected) return null;
    return buildViolation(rule, actual, `status is ${actual}`);
  }

  // Standard numeric
  const actual    = parseFloat(metrics[rule.metric]);
  const threshold = parseFloat(rule.threshold);
  if (isNaN(actual)) return null;

  const breached =
    rule.operator === '<' ? actual < threshold  :
    rule.operator === '>' ? actual > threshold  :
    rule.operator === '=' ? actual === threshold : false;

  if (!breached) return null;
  return buildViolation(rule, String(actual), null);
}

function buildViolation(rule, actual, customMessage) {
  return {
    rule_id:      rule.id,
    workspace_id: rule.workspace_id,
    entity_id:    rule.entity_id,
    entity_name:  rule.entity_name,
    entity_type:  rule.entity_type,
    alert_name:   rule.alert_name,
    metric:       rule.metric,
    operator:     rule.operator,
    threshold:    rule.threshold,
    actual_value: actual,
    message:      customMessage
                  || `${rule.metric} is ${actual} (rule: ${rule.operator} ${rule.threshold})`,
    diff: (!isNaN(parseFloat(actual)) && !isNaN(parseFloat(rule.threshold)))
          ? Math.abs(parseFloat(actual) - parseFloat(rule.threshold)).toFixed(2)
          : null
  };
}
```

---

## Meta Batch API pattern

```javascript
// Group rules by ad_account_id
// For each account, build batch requests (max 50 per call)
const batch = entityIds.map(id => ({
  method: 'GET',
  relative_url: `${id}?fields=id,name,status,effective_status,` +
    `daily_budget,insights.date_preset(yesterday)` +
    `{spend,impressions,clicks,ctr,cpc,reach,frequency}`
}));

const response = await axios.post(
  'https://graph.facebook.com/v19.0/',
  { batch: JSON.stringify(batch), access_token: accountToken },
  { headers: { 'Content-Type': 'application/json' } }
);

// response.data is an array of { code, body } objects
// Parse each body as JSON, extract insights.data[0] for metrics
// budget_utilisation = (spend / daily_budget) * 100  — computed here
```

---

## Frontend file structure

```
frontend/
  src/
    pages/
      Login.jsx
      AcceptInvite.jsx              -- reads ?token= from URL
      admin/
        Dashboard.jsx               -- list all workspaces + users
        WorkspaceDetail.jsx         -- manage accounts, invite, revoke, reassign
      workspace/
        Dashboard.jsx               -- rule status cards, active violations, last run
        RulesManager.jsx            -- add/edit/toggle/delete/snooze rules
        ActivityLog.jsx             -- alert history, filterable
        AlertSettings.jsx           -- notification email
    components/
      PrivateRoute.jsx              -- checks auth + role, redirects if wrong
      RuleRow.jsx
      ViolationCard.jsx
      NavBar.jsx
      EntityPicker.jsx              -- drill-down: account → campaign → adset → ad
    lib/
      supabase.js                   -- supabase client init
      api.js                        -- typed wrappers around supabase queries
      auth.js                       -- getRole(), getWorkspaceId(), signOut()
```

---

## Backend (cron worker) file structure

```
cron-worker/
  src/
    index.js                        -- registers node-cron, calls runJob
    runJob.js                       -- orchestration (see steps above)
    evaluator.js                    -- evaluate() + buildViolation()
    meta/
      batchFetch.js                 -- Meta Batch API wrapper
      entitySync.js                 -- refresh entity_cache
    db/
      supabaseClient.js             -- supabase-js client (service role key)
      queries.js                    -- all DB reads/writes
    email/
      sender.js                     -- SendGrid wrapper
      alertTemplate.js              -- HTML alert email
    config/
      index.js                      -- env vars
```

---

## Supabase Edge Functions

```
supabase/functions/
  send-invite/index.ts              -- POST: generate token, insert invitation, send email
  accept-invite/index.ts            -- POST: verify token, create user, link workspace
  validate-entity/index.ts          -- GET: check entity_id exists in entity_cache
  refresh-entity-cache/index.ts     -- POST: trigger cache refresh for one ad account
```

---

## Environment variables

```bash
# Supabase (frontend + cron worker)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...              # frontend only
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # cron worker + Edge Functions only

# Meta API (cron worker)
# Note: per-account tokens are stored in workspace_ad_accounts table
# No global Meta token needed

# SendGrid (cron worker + Edge Functions)
SENDGRID_API_KEY=SG.xxxxxxxxxx
EMAIL_FROM=alerts@yourcompany.com

# App
FRONTEND_URL=https://portal.yourcompany.com
CRON_SCHEDULE=0 */6 * * *
JWT_INVITE_SECRET=your-long-random-string  # for signing invite tokens

# Cron worker (Railway)
# Connect to Supabase via SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
# No direct DB connection string needed — use supabase-js client
```

---

## Row Level Security (RLS) policies

Enable RLS on all tables except cron_run_log (backend-only).

```sql
-- workspaces: user sees only their own
CREATE POLICY workspace_isolation ON workspaces
  FOR ALL USING (user_id = auth.uid()::uuid
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    ));

-- validation_rules: scoped to workspace
CREATE POLICY rules_workspace_isolation ON validation_rules
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE user_id = auth.uid()::uuid
    )
    OR EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- Same pattern for: alert_log, rule_audit_log, entity_cache, workspace_ad_accounts
-- Super admin bypasses all via role check
-- Cron worker uses service_role key which bypasses RLS entirely
```

---

## Open decisions (resolve before building)

- [ ] **Token encryption:** Store Meta access tokens encrypted in `workspace_ad_accounts`.
      Use Supabase Vault (built-in) or AES-256 at application level before INSERT.
      Supabase Vault is simpler — use it.

- [ ] **Entity cache stale threshold:** Currently 6 hours. Adjust if needed.
      Users with fast-moving campaigns may want 1–2 hours.

- [ ] **ROAS and cost_per_result:** Only available if conversion tracking is set up
      in the Meta account. Handle gracefully — if insights return null for these fields,
      skip the rule and log a warning rather than crashing.

- [ ] **Rate limits:** Meta API allows ~200 calls/hour per token. With Batch API
      (50 requests per call), this is effectively 10,000 entity fetches/hour per token.
      Should be sufficient. Monitor cron_run_log for errors.

- [ ] **Notification email fallback:** If workspace.notification_email is NULL,
      fall back to the workspace user's auth email. Do not silently skip.

- [ ] **Super admin seeding:** No signup flow for super admins. Seed manually:
      Insert into auth.users via Supabase dashboard, then insert user_profiles
      row with role='super_admin' and workspace_id=NULL.

---

## What NOT to do

- Do not store metric data (spend, CTR, etc.) in Supabase. Fetch live, discard after eval.
- Do not call Meta API from the frontend. All Meta calls go through the cron worker.
- Do not use Supabase Edge Functions for the cron job — they will time out.
- Do not trust workspace_id from request body. Always read it from the authenticated
  user's session / user_profiles row.
- Do not return access_token from workspace_ad_accounts to the frontend. Ever.
- Do not use WidthType.PERCENTAGE in any table definitions — breaks in some clients.

---

*Generated from planning conversation — April 2026*
*Update this file as decisions change. It is the source of truth for Claude Code.*
