-- ============================================================
-- SpendGuard — Budget Intelligence Layer
-- Addendum: adds 6 new columns to entity_cache
-- ============================================================

ALTER TABLE entity_cache ADD COLUMN IF NOT EXISTS budget_source         VARCHAR(30);
-- 'campaign' = CBO active, 'adset' = adset-level budget

ALTER TABLE entity_cache ADD COLUMN IF NOT EXISTS budget_type           VARCHAR(20);
-- 'daily' | 'lifetime' | null

ALTER TABLE entity_cache ADD COLUMN IF NOT EXISTS lifetime_budget       NUMERIC;
-- Raw value in account currency (already divided by 100 on insert)

ALTER TABLE entity_cache ADD COLUMN IF NOT EXISTS campaign_budget_opt   BOOLEAN DEFAULT FALSE;
-- TRUE if CBO is enabled. Denormalised onto adset rows too.

ALTER TABLE entity_cache ADD COLUMN IF NOT EXISTS budget_change_count   INTEGER DEFAULT 0;
-- How many times budget changed this month

ALTER TABLE entity_cache ADD COLUMN IF NOT EXISTS last_budget_changed_at TIMESTAMP;
-- When budget last changed

ALTER TABLE entity_cache ADD COLUMN IF NOT EXISTS meta_created_time     TIMESTAMP;
-- From Meta: created_time field on campaign/adset
