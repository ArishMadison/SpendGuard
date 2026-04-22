# SpendGuard -- Deployment Guide

> How to set up, configure, and deploy SpendGuard.
> Version 1.0 | April 2026

---

## 1. Prerequisites

- Node.js 18+ installed
- A Supabase project (free tier works for development)
- A Meta Business Manager account with System User access
- A SendGrid account with API key
- A GitHub account (for source control)

## 2. Supabase Setup

### 2.1 Create Project

1. Go to https://supabase.com and create a new project
2. Note down:
   - Project URL: `https://xxxx.supabase.co`
   - Anon key: `eyJ...` (for frontend)
   - Service role key: `eyJ...` (for backend -- keep secret)

### 2.2 Run Migrations

Apply the database schema in order:

```bash
# From the project root, using Supabase CLI:
supabase db push

# Or manually in Supabase SQL Editor:
# 1. Run supabase/migrations/001_initial_schema.sql
# 2. Run supabase/migrations/002_budget_intelligence.sql
```

This creates all 8+ tables, indexes, RLS policies, helper functions, and the
audit trigger.

### 2.3 Seed Super Admin

There is no signup flow for super admins. Seed manually:

1. Go to Supabase Dashboard > Authentication > Users
2. Click "Add User" > enter email and password
3. Go to SQL Editor and run:

```sql
INSERT INTO user_profiles (id, role, workspace_id)
VALUES (
  '<user-uuid-from-step-2>',
  'super_admin',
  NULL
);
```

## 3. Meta Business Manager Setup

### 3.1 Create System User

1. Go to Meta Business Manager > Business Settings > System Users
2. Create a System User (admin level)
3. Assign it to the ad accounts you want to monitor
4. Generate a token with these permissions:
   - `ads_read`
   - `ads_management` (for reading campaign data)
   - `business_management`
5. Copy the token (this is your `SYSTEM_USER_TOKEN`)

### 3.2 Token Notes

- System User tokens do not expire (unlike user tokens)
- The token is stored server-side only; never sent to the frontend
- One token works across all ad accounts the System User has access to
- When linking ad accounts, the backend uses this single token

## 4. SendGrid Setup

1. Create a SendGrid account at https://sendgrid.com
2. Go to Settings > API Keys > Create API Key (Full Access)
3. Copy the key (this is your `SENDGRID_API_KEY`)
4. Verify a sender identity for `EMAIL_FROM`

## 5. Local Development

### 5.1 Clone and Install

```bash
git clone https://github.com/ArishMadison/SpendGuard.git
cd SpendGuard

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install backend dependencies
cd cron-worker && npm install && cd ..
```

### 5.2 Configure Environment

**Frontend** -- create `frontend/.env`:
```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_API_URL=http://localhost:3001
```

**Backend** -- create `cron-worker/.env`:
```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

SENDGRID_API_KEY=SG.xxxxxxxxxx
EMAIL_FROM=alerts@yourcompany.com

JWT_INVITE_SECRET=your-long-random-string-at-least-32-chars

FRONTEND_URL=http://localhost:5173
CRON_SCHEDULE=0 */6 * * *

SYSTEM_USER_TOKEN=EAA...your-meta-system-user-token

PORT=3001
```

### 5.3 Start Development Servers

```bash
# Terminal 1: Frontend (Vite dev server on port 5173)
cd frontend && npm run dev

# Terminal 2: Backend (Express + Cron on port 3001)
cd cron-worker && node src/server.js
```

### 5.4 First Login

1. Open http://localhost:5173
2. Log in with the super admin email/password from step 2.3
3. Create a workspace
4. Link an ad account (will auto-sync entities from Meta)
5. Send an invite to create a workspace user

## 6. Production Deployment

### 6.1 Frontend (Static Hosting)

Build the frontend and deploy to any static host (Vercel, Netlify, Cloudflare
Pages, etc.):

```bash
cd frontend
npm run build
# Output in frontend/dist/
```

Set environment variables in your hosting provider:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` (your production backend URL)

### 6.2 Backend (Railway / Render / VPS)

Deploy the `cron-worker` directory as a Node.js service:

**Railway:**
1. Create a new project on Railway
2. Connect your GitHub repo
3. Set root directory to `cron-worker`
4. Set start command: `node src/server.js`
5. Add all environment variables from section 5.2
6. Deploy

**Generic:**
```bash
cd cron-worker
node src/server.js
```

The server starts both the Express API (for invites, linking, etc.) and the
cron scheduler (for periodic evaluation). Both run in the same process.

### 6.3 Post-Deployment Checklist

- [ ] Supabase migrations applied
- [ ] Super admin user seeded
- [ ] Meta System User token configured
- [ ] SendGrid API key and sender verified
- [ ] Frontend VITE_API_URL points to production backend
- [ ] Backend FRONTEND_URL points to production frontend (for email links)
- [ ] Test: create workspace, link account, send invite, accept invite
- [ ] Test: create a rule, trigger manual job (`POST /run-job`), verify email
- [ ] Monitor cron_run_log for errors after first automated run

## 7. Monitoring

### Cron Health

- Check `cron_run_log` table in Supabase dashboard
- Each run records: workspaces processed, rules evaluated, violations found,
  emails sent, errors (JSONB)
- Status: `running`, `completed`, or `failed`

### Entity Sync

- Check `entity_cache.last_synced_at` for freshness
- After sync, entities not refreshed are purged (no longer active on Meta)
- Monitor backend logs for `[entitySync]` messages

### Alerts

- `alert_log` with `resolved_at IS NULL` = active violations
- `alert_log` with `resolved_at IS NOT NULL` = historical/resolved
- `notified = true` confirms email was sent

## 8. Troubleshooting

| Issue | Likely cause | Fix |
|---|---|---|
| Login redirects to login | Route mismatch or missing user_profiles row | Check user_profiles table has matching UUID and role |
| 0/10 ad accounts on workspaces page | listWorkspaces query missing relation | Verify api.js includes `workspace_ad_accounts` in select |
| Entity sync fails with (190) | Meta token expired or invalid | Regenerate System User token |
| Entity sync fails with (200) | Token lacks permission | Check System User has ads_read permission |
| No budget shown | Campaign uses ABO (budget at adset level) | Expand adset rows to see budget; or campaign genuinely has no budget set |
| Rules not triggering | Entity not in cache (purged as inactive) | Verify entity is ACTIVE on Meta; re-sync cache |
| Email not sent | SendGrid config error | Check SENDGRID_API_KEY and EMAIL_FROM in .env; verify sender identity |
| Rate limit (17) | Too many Meta API calls | Wait a few minutes; check batch sizes |
