# SpendGuard -- Product Document

> Campaign Alert Portal for Meta Ads validation and monitoring.
> Version 1.0 | April 2026

---

## 1. Problem Statement

Media teams managing Meta Ads campaigns across multiple clients rely on manual
Google Sheets to track whether campaigns meet budget, objective, and frequency
standards. This leads to missed violations, delayed responses, and zero audit
trail. When a campaign deviates from its intended configuration, hours pass
before anyone notices.

## 2. Solution

SpendGuard is a multi-tenant web portal where approved users manage validation
rules against their Meta Ads campaigns. A scheduled job runs every 6 hours,
fetches live campaign data from the Meta Ads API, evaluates each rule, and sends
alert emails only when a rule is breached.

Rules live in a database, managed through a portal UI, with a full audit trail
of every change.

## 3. Users and Roles

### Super Admin

Internal operations person. Cannot be self-registered (seeded manually via
Supabase dashboard).

| Capability | Details |
|---|---|
| Create workspaces | One workspace per client |
| Link ad accounts | Up to 10 Meta ad accounts per workspace; one account cannot belong to two workspaces |
| Send invites | Generates 24-hour invite link sent via email |
| Revoke access | Removes user; preserves workspace and rules for reassignment |
| Manage all rules | View, pause, resume, snooze, delete rules across all workspaces |
| View alerts | All active and resolved violations across all workspaces |
| View activity | Audit log of all rule changes, invites, and sync runs with user attribution |
| Configure settings | Notification email per workspace |

### Workspace User

One approved person per workspace (1:1 strict). Sees only their own workspace.

| Capability | Details |
|---|---|
| View campaigns | Hierarchical view: campaigns and adsets with budget, rules, and violation indicators |
| Create rules | 5 rule types on any campaign or adset in their workspace |
| Manage rules | Pause, resume, snooze, delete their own rules |
| View alerts | Alert history with active/resolved filter |
| View settings | Notification email (read-only; set by admin), password reset |

## 4. Workspace Model

```
1 workspace --> 1 client --> 1 user --> N ad accounts (max 10)
```

- One workspace per client. Not one workspace per ad account.
- Multiple Meta ad accounts live inside one workspace.
- Each ad account uses the platform's System User token (stored server-side).
- An ad account can only be linked to one workspace at a time.

## 5. Rule Types

Rules are created per campaign or adset. Each rule defines a condition that,
when true, triggers an alert. All rules use the framing **"Alert me when..."**

### 5.1 Campaign Objective

Check whether a campaign's objective matches or doesn't match a specific type.

| Field | Value |
|---|---|
| Metric | `campaign_objective` |
| Operator | `is` or `is not` |
| Threshold | One of: OUTCOME_AWARENESS, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES, OUTCOME_TRAFFIC, OUTCOME_APP_PROMOTION |

Example: "Alert me when objective **is not** OUTCOME_SALES"

### 5.2 Budget Level

Check whether budget is set at campaign level (CBO) or adset level (ABO).

| Field | Value |
|---|---|
| Metric | `budget_level` |
| Operator | `is` or `is not` |
| Threshold | `campaign` (CBO) or `adset` (ABO) |

Example: "Alert me when budget level **is** adset" (expecting CBO)

### 5.3 Budget Type

Check whether budget is daily or lifetime.

| Field | Value |
|---|---|
| Metric | `budget_type` |
| Operator | `is` or `is not` |
| Threshold | `daily` or `lifetime` |

Example: "Alert me when budget type **is** lifetime" (all campaigns should use daily)

### 5.4 Budget Threshold

Check whether remaining daily or lifetime budget crosses a numeric value.

| Field | Value |
|---|---|
| Metric | `budget_threshold` |
| Operator | `below`, `above`, or `exactly` |
| Threshold | Numeric, stored as `daily:{amount}` or `lifetime_remaining:{amount}` |

Example: "Alert me when daily budget is **below** 5,000"

For lifetime remaining: effective budget = lifetime_budget minus total spend.

### 5.5 Budget Change Frequency

Check how many times a campaign or adset's budget has been changed this month.

| Field | Value |
|---|---|
| Metric | `budget_change_frequency_monthly` |
| Operator | `below`, `above`, or `exactly` |
| Threshold | Integer count |

Example: "Alert me when budget changes this month are **above** 5"

## 6. Alert Pipeline

### 6.1 Schedule

Cron runs every 6 hours: midnight, 06:00, 12:00, 18:00.

### 6.2 Evaluation Flow

```
1. Refresh entity cache (sync campaigns/adsets/ads from Meta)
2. Purge entities no longer active on Meta
3. Load all active, non-snoozed rules
4. Batch-fetch metrics from Meta (insights + entity fields)
5. Evaluate each rule against live data
6. Deduplicate -- only NEW violations create alerts
7. Resolve -- violations that no longer breach are marked resolved
8. Email -- new violations grouped by notification email, sent via SendGrid
```

### 6.3 Deduplication

If a rule was already breaching in a previous run and is still breaching, no
new alert is created. The existing alert's `last_alerted_at` is updated.

### 6.4 Resolution

If a rule was breaching but is no longer breaching, the alert is marked
resolved with `resolved_at` timestamp.

### 6.5 Email Format

Alert emails are grouped by ad account, with a table showing:
- Entity name and type
- Alert name
- Rule condition (metric, operator, threshold)
- Actual value at breach time
- Link to the workspace portal

## 7. Entity Cache Strategy

Metrics (spend, CTR, etc.) are fetched live from Meta at cron time, evaluated
in memory, and discarded. Only violations are stored. Entity structure data
(names, budgets, objectives, statuses) is cached.

### Refresh Triggers

| Trigger | When |
|---|---|
| Account link | Immediately when super admin links an ad account |
| On demand | User opens campaign view; if cache older than 6 hours, auto-refresh |
| Cron job | Before evaluation, cache is refreshed for all active accounts |

### Purge Strategy

- After each sync, entities not refreshed (no longer ACTIVE on Meta) are deleted
- Global stale purge: entities not synced in 30+ days are removed as a safety net
- Only ACTIVE entities are fetched from Meta (filtered by `effective_status`)

## 8. Portal Pages

### Super Admin Portal

| Page | URL | Purpose |
|---|---|---|
| Overview | `/admin` | Stat cards, Rules & Violations table (hover for details), recent activity, sync runs |
| Workspaces | `/admin/workspaces` | List all workspaces with ad account count, user status, actions |
| Workspace Detail | `/admin/workspaces/:id` | 3 tabs: Campaigns & Rules, Alerts, Settings |
| All Rules | `/admin/rules` | Flat list of all rules across workspaces with status filter tabs (All/Active/Paused/Snoozed), inline actions, colored metric tags |
| All Alerts | `/admin/alerts` | All violations across workspaces with active/resolved filter |
| Activity | `/admin/activity` | Audit log + sync runs; human-readable diffs; user attribution (admin vs user badge) |
| Settings | `/admin/settings` | Platform-level settings |

### Workspace User Portal

| Page | URL | Purpose |
|---|---|---|
| Dashboard | `/workspace` | Stat cards, active violations, rule health summary |
| Campaigns | `/workspace/campaigns` | Campaign tree with budgets, rules, violations; filter dropdown; inline rule management |
| Rules | `/workspace/rules` | Full rule CRUD with entity picker; status filter tabs |
| Alerts | `/workspace/activity` | Alert history with active/resolved filter and search |
| Settings | `/workspace/settings` | Notification email (read-only), account info, password reset |

## 9. Visual Indicators

### Campaign Rows

- Blue left border + subtle blue background: campaign has rules set
- Red left border + subtle red background: campaign has active violations

### Metric Tags (color-coded)

| Metric | Color |
|---|---|
| Campaign objective | Purple |
| Budget level | Teal |
| Budget type | Indigo |
| Budget threshold | Blue |
| Change frequency | Amber |

### Status Badges

| Status | Color |
|---|---|
| Active | Green |
| Paused | Gray |
| Snoozed | Yellow/Amber |

### Audit Actions

| Action | Color |
|---|---|
| Created / Accepted | Green |
| Updated / Invited | Blue |
| Deleted / Revoked | Red |
| Toggled / Snoozed | Yellow |

## 10. Security Model

| Layer | Mechanism |
|---|---|
| Authentication | Supabase Auth (email/password, session tokens, auto-refresh) |
| Authorization | Role-based: `super_admin` and `workspace_user` in `user_profiles` |
| Data isolation | PostgreSQL Row Level Security on all tables (except `cron_run_log`) |
| Token security | Meta System User token stored server-side only; never sent to frontend |
| Invite security | Signed JWT tokens with 24-hour expiry; single-use; revocable |
| API protection | All backend endpoints verify Supabase JWT + role check |
| Cron worker | Uses `service_role` key (bypasses RLS); runs server-side only |

## 11. Constraints and Limits

| Constraint | Value |
|---|---|
| Ad accounts per workspace | 10 |
| Users per workspace | 1 |
| Ad account uniqueness | One account can only be linked to one workspace |
| Cron frequency | Every 6 hours |
| Meta API date preset | `yesterday` (today's data is incomplete) |
| Meta Batch API limit | 50 requests per call |
| Invite token expiry | 24 hours |
| Entity cache staleness | 6-hour threshold for on-demand refresh |
| Stale entity purge | 30 days without sync |
