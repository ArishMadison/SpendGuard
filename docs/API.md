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

## Frontend Supabase Queries

The frontend queries Supabase directly (protected by RLS). Key functions in
`frontend/src/lib/api.js`:

| Function | Table | Description |
|---|---|---|
| `listWorkspaces()` | workspaces | All workspaces with ad accounts and user profiles |
| `getWorkspace(id)` | workspaces | Single workspace with ad accounts |
| `createWorkspace(payload)` | workspaces | Insert new workspace |
| `updateWorkspace(id, payload)` | workspaces | Update workspace fields |
| `listAdAccounts(wsId)` | workspace_ad_accounts | Ad accounts for a workspace (no token) |
| `listRules(wsId)` | validation_rules | All rules for a workspace |
| `createRule(payload)` | validation_rules | Insert new rule |
| `updateRule(id, payload)` | validation_rules | Update rule fields |
| `deleteRule(id)` | validation_rules | Delete a rule |
| `toggleRule(id, active)` | validation_rules | Toggle rule active state |
| `listAlerts(wsId, opts)` | alert_log | Alerts for a workspace (optional activeOnly filter) |
| `listCampaignsView(wsId)` | entity_cache + validation_rules + alert_log | Enriched campaign tree with rules and violations |
| `listCronRuns(limit)` | cron_run_log | Recent cron executions |
| `listAllAuditLog(limit)` | rule_audit_log | All audit entries across workspaces |
| `listAllInvitations(limit)` | invitations | All invitation records |
