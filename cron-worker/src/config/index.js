require('dotenv').config()

function required(name) {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

module.exports = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  sendgridApiKey: required('SENDGRID_API_KEY'),
  emailFrom: required('EMAIL_FROM'),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  cronSchedule: process.env.CRON_SCHEDULE || '0 */6 * * *',
  jwtInviteSecret: required('JWT_INVITE_SECRET'),
  metaAppId: process.env.META_APP_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  // System User token for all Meta API calls — never exposed to the frontend
  systemUserToken: process.env.SYSTEM_USER_TOKEN || '',
}
