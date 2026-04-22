const { createClient } = require('@supabase/supabase-js')
const config = require('../config')

// Service role key bypasses RLS — only use in cron worker, never expose to frontend
const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey)

module.exports = { supabase }
