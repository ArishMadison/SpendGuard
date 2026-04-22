# SpendGuard -- API Reference

> All backend API endpoints served by the cron-worker Express server.
> Base URL: `http://localhost:3001` (configurable via PORT env var)

---

## Authentication

All authenticated endpoints require a Supabase JWT in the `Authorization` header:

```
Authorization: Bearer <supabase_access_token>
```

The backend verifies this token via `supabase.auth.getUser(token)`. Super admin
endpoints additionally check the `user_profiles.role` field.

---

## Endpoints

### POST /send-invite

Send an invite email to grant workspace access.

**Auth:** Super admin only

**Request body:**
```json
{
  "workspace_id": 2,
  "email": "user@client.com"
}
```

**Validation:**
- Workspace must have at least 1 linked ad account
- Generates signed JWT with 24-hour expiry
- Inserts row in `invitations` table
- Sends email via SendGrid with accept link

**Response (200):**
```json
{ "success": true }
```

**Errors:**
- 400: Missing fields, no ad accounts linked
- 401: Unauthorized
- 403: Not super admin

---

### POST /accept-invite

Accept an invitation and create a user account.

**Auth:** Public (token-based)

**Request body:**
```json
{
  "token": "eyJhbG...",
  "password": "minimum8chars"
}
```

**Flow:**
1. Verify JWT signature and expiry
2. Check invitations table (not revoked, not accepted)
3. Create Supabase Auth user
4. Insert user_profiles row (workspace_user role)
5. Link user to workspace; set notification_email if not already set
6. Mark invitation accepted
7. Trigger background entity sync for all linked ad accounts
8. Sign in and return session

**Response (200):**
```json
{
  "success": true,
  "session": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_in": 3600,
    "user": { ... }
  }
}
```

**Errors:**
- 400: Missing fields, invalid/expired token, already accepted, revoked, password too short

---

### POST /remove-user

Remove a workspace user. Deletes auth account, preserves workspace and rules.

**Auth:** Super admin only

**Request body:**
```json
{
  "workspace_id": 2
}
```

**Flow:**
1. Get current user_id from workspace
2. Delete Supabase Auth user via admin API
3. Clear workspace.user_id
4. Delete user_profiles row

**Response (200):**
```json
{ "success": true }
```

---

### POST /link-ad-account

Link a Meta ad account to a workspace.

**Auth:** Super admin only

**Request body:**
```json
{
  "workspace_id": 2,
  "ad_account_id": "act_882341345153629",
  "account_name": "Brand Campaign Account"
}
```

**Validation:**
- Max 10 ad accounts per workspace
- Ad account cannot be linked to a different workspace (cross-workspace uniqueness)
- Uses server-side SYSTEM_USER_TOKEN (never from frontend)

**Flow:**
1. Check cross-workspace uniqueness
2. Check per-workspace limit (10)
3. If already linked to this workspace: update name and token
4. If new: insert row
5. Trigger immediate entity cache sync

**Response (200):**
```json
{ "success": true }
```

**Errors:**
- 400: Already linked to another workspace, limit reached
- 500: SYSTEM_USER_TOKEN not configured

---

### POST /refresh-entity-cache

Trigger entity cache refresh for a specific ad account.

**Auth:** Authenticated (any role)

**Request body:**
```json
{
  "workspace_id": 2,
  "ad_account_id": "act_882341345153629"
}
```

**Response (200):**
```json
{ "success": true }
```

---

### POST /run-job

Manually trigger the cron evaluation job.

**Auth:** Super admin only

**Response (200):**
```json
{
  "success": true,
  "stats": {
    "workspacesProcessed": 2,
    "rulesEvaluated": 5,
    "violationsFound": 2,
    "newViolations": 1,
    "emailsSent": 1,
    "errors": [],
    "failed": false
  }
}
```

---

### GET /ad-accounts

Fetch all Meta ad accounts accessible via the platform's System User token.

**Auth:** Super admin only

**Response (200):**
```json
{
  "ad_accounts": [
    {
      "id": "act_882341345153629",
      "name": "Brand Campaign Account",
      "currency": "INR",
      "active": true
    }
  ]
}
```

**Notes:**
- Uses server-side SYSTEM_USER_TOKEN
- Token is never sent to or from the frontend
- Paginates through all accounts (limit 100 per page)

---

### GET /validate-entity

Check if an entity exists in the entity cache.

**Auth:** Authenticated (any role)

**Query params:**
- `entity_id` (required): The Meta entity ID
- `workspace_id` (required): The workspace ID

**Response (200):**
```json
{
  "valid": true,
  "entity": {
    "entity_id": "120207117933690269",
    "entity_type": "campaign",
    "name": "Brand Campaign Q4",
    "status": "ACTIVE",
    "ad_account_id": "act_882341345153629"
  }
}
```

**Response (404):**
```json
{ "valid": false, "error": "Entity not found in cache" }
```

---

### GET /health

Health check endpoint.

**Auth:** Public

**Response (200):**
```json
{ "status": "ok" }
```

---

## Data Endpoints

All frontend data queries route through the backend. The frontend never queries
the database directly. Each endpoint verifies the JWT, checks role, and
enforces workspace access.

### GET /me

Returns the authenticated user's profile.

**Auth:** Authenticated

**Response (200):**
```json
{ "role": "super_admin", "workspace_id": null }
```

---

### GET /workspaces

List workspaces. Super admin sees all; workspace user sees only their own.

**Auth:** Authenticated

**Response (200):** Array of workspace objects with `workspace_ad_accounts`.

---

### GET /workspaces/:id

Single workspace with ad accounts and assigned user email.

**Auth:** Workspace access (owner or super admin)

**Response (200):** Workspace object. `access_token` is stripped from ad accounts.
Includes `assigned_user_email` if a user is linked.

---

### POST /workspaces

Create a new workspace.

**Auth:** Super admin

**Request body:**
```json
{ "name": "Client Name" }
```

---

### PATCH /workspaces/:id

Update workspace fields.

**Auth:** Super admin

**Request body:** Any workspace fields to update.

---

### GET /workspaces/:id/ad-accounts

List ad accounts for a workspace (access_token excluded).

**Auth:** Workspace access

---

### GET /workspaces/:id/rules

List all rules for a workspace.

**Auth:** Workspace access

---

### GET /workspaces/:id/alerts

List alerts for a workspace.

**Auth:** Workspace access

**Query params:**
- `active_only=true` (optional): Only return unresolved alerts

---

### GET /workspaces/:id/campaigns

Enriched campaign view: entities + rules + active violations per entity.

**Auth:** Workspace access

**Response (200):** Array of entity objects, each with `rules` (array) and
`violations` (count).

---

### GET /workspaces/:id/entities

Entity cache rows for a workspace.

**Auth:** Workspace access

**Query params:**
- `entity_type` (optional): Filter by `campaign`, `adset`, or `ad`

---

### POST /rules

Create a new validation rule. Backend sets `created_by` and `updated_by` from
the JWT — frontend does not need to pass these fields.

**Auth:** Workspace access (checked against `workspace_id` in body)

**Request body:**
```json
{
  "workspace_id": 2,
  "ad_account_id": "act_882341345153629",
  "entity_type": "campaign",
  "entity_id": "120207117933690269",
  "entity_name": "Brand Campaign Q4",
  "metric": "budget_threshold",
  "operator": ">",
  "threshold": "daily:5000",
  "alert_name": "Low daily budget"
}
```

---

### PATCH /rules/:id

Update a rule. Backend verifies workspace access via the rule's workspace_id.

**Auth:** Workspace access

**Request body:** Any rule fields to update.

---

### DELETE /rules/:id

Delete a rule.

**Auth:** Workspace access

---

### GET /all-rules

All rules across all workspaces (with workspace name join).

**Auth:** Super admin

---

### GET /all-alerts

All alerts across all workspaces (limit 200).

**Auth:** Super admin

---

### GET /cron-runs

Cron execution history.

**Auth:** Authenticated

**Query params:**
- `limit` (optional, default 20)

---

### GET /audit-log

Rule audit log entries across all workspaces.

**Auth:** Super admin

**Query params:**
- `limit` (optional, default 300)

---

### GET /invitations

All invitation records.

**Auth:** Super admin

---

### GET /user-profiles

All user profiles (id, role, workspace_id).

**Auth:** Super admin

---

### GET /ad-account-map

Ad account ID to name mapping for display purposes.

**Auth:** Authenticated

---

### GET /admin-dashboard

Aggregated data for the admin overview page in a single request. Returns
workspaces, sync runs, active alerts, recent activity, rule count, campaigns,
and all rules.

**Auth:** Super admin

**Response (200):**
```json
{
  "workspaces": [...],
  "syncRuns": [...],
  "alerts": [...],
  "activity": [...],
  "ruleCount": 12,
  "campaigns": [...],
  "allRules": [...]
}
```

---

## Frontend API Functions

All functions in `frontend/src/lib/api.js` use `apiCall()` which sends
requests to the backend with the Supabase JWT as authorization:

| Function | Backend Endpoint | Description |
|---|---|---|
| `fetchMyProfile()` | GET /me | Current user role + workspace |
| `listWorkspaces()` | GET /workspaces | All workspaces |
| `getWorkspace(id)` | GET /workspaces/:id | Single workspace |
| `createWorkspace(payload)` | POST /workspaces | Create workspace |
| `updateWorkspace(id, payload)` | PATCH /workspaces/:id | Update workspace |
| `listAdAccounts(wsId)` | GET /workspaces/:id/ad-accounts | Workspace ad accounts |
| `listRules(wsId)` | GET /workspaces/:id/rules | Workspace rules |
| `listAllRules()` | GET /all-rules | All rules (admin) |
| `createRule(payload)` | POST /rules | Create rule |
| `updateRule(id, payload)` | PATCH /rules/:id | Update rule |
| `deleteRule(id)` | DELETE /rules/:id | Delete rule |
| `toggleRule(id, active)` | PATCH /rules/:id | Toggle active |
| `listAlerts(wsId, opts)` | GET /workspaces/:id/alerts | Workspace alerts |
| `listAllAlerts()` | GET /all-alerts | All alerts (admin) |
| `listCampaignsView(wsId)` | GET /workspaces/:id/campaigns | Enriched campaigns |
| `listEntities(wsId, type)` | GET /workspaces/:id/entities | Entity cache |
| `listCronRuns(limit)` | GET /cron-runs | Cron history |
| `listAllAuditLog(limit)` | GET /audit-log | Audit entries (admin) |
| `listAllInvitations(limit)` | GET /invitations | Invitations (admin) |
| `listUserProfiles()` | GET /user-profiles | User profiles (admin) |
| `listAdAccountMap()` | GET /ad-account-map | Account name lookup |
| `fetchAdminDashboard()` | GET /admin-dashboard | Aggregated admin data |
