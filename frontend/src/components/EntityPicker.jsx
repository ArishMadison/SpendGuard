import { useEffect, useState } from 'react'
import { listEntities, refreshEntityCache } from '../lib/api.js'

const ENTITY_TYPES = ['campaign', 'adset', 'ad']

/**
 * Drill-down entity picker: account → campaign → adset → ad
 * Props:
 *   workspaceId  — integer
 *   adAccounts   — array of { ad_account_id, account_name }
 *   onSelect     — fn({ entity_id, entity_type, entity_name, ad_account_id })
 */
export default function EntityPicker({ workspaceId, adAccounts, onSelect }) {
  const [selectedAccount, setSelectedAccount] = useState('')
  const [entityType, setEntityType] = useState('campaign')
  const [entities, setEntities] = useState([])
  const [selectedParent, setSelectedParent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [lastSynced, setLastSynced] = useState(null)

  useEffect(() => {
    if (!selectedAccount) return
    loadEntities()
  }, [selectedAccount, entityType])

  async function loadEntities() {
    setLoading(true)
    try {
      const all = await listEntities(workspaceId, entityType)
      const filtered = all.filter(e => e.ad_account_id === selectedAccount)

      // Check staleness — if oldest record > 6h, trigger refresh
      if (filtered.length > 0) {
        const oldest = new Date(Math.min(...filtered.map(e => new Date(e.last_synced_at))))
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
        setLastSynced(oldest)
        if (oldest < sixHoursAgo) {
          triggerCacheRefresh()
        }
      }

      // For adsets/ads, filter by parent
      if (entityType === 'adset' && selectedParent) {
        setEntities(filtered.filter(e => e.parent_id === selectedParent))
      } else if (entityType === 'ad' && selectedParent) {
        setEntities(filtered.filter(e => e.parent_id === selectedParent))
      } else {
        setEntities(filtered)
      }
    } finally {
      setLoading(false)
    }
  }

  async function triggerCacheRefresh() {
    await refreshEntityCache(workspaceId, selectedAccount)
    // Reload after a short delay
    setTimeout(loadEntities, 3000)
  }

  function handleSelect(entity) {
    onSelect({
      entity_id: entity.entity_id,
      entity_type: entity.entity_type,
      entity_name: entity.name,
      ad_account_id: entity.ad_account_id,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div>
        <label>Ad Account</label>
        <select value={selectedAccount} onChange={e => { setSelectedAccount(e.target.value); setSelectedParent(null) }}>
          <option value="">— Select account —</option>
          {adAccounts.map(a => (
            <option key={a.ad_account_id} value={a.ad_account_id}>
              {a.account_name || a.ad_account_id}
            </option>
          ))}
        </select>
      </div>

      {selectedAccount && (
        <div>
          <label>Entity Type</label>
          <select value={entityType} onChange={e => { setEntityType(e.target.value); setSelectedParent(null) }}>
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}

      {selectedAccount && (
        <div>
          <label>{loading ? 'Syncing...' : `${entityType}s`}</label>
          <select onChange={e => handleSelect(entities.find(en => en.entity_id === e.target.value))} defaultValue="">
            <option value="">— Select {entityType} —</option>
            {entities.map(e => (
              <option key={e.entity_id} value={e.entity_id}>
                {e.name} ({e.status})
              </option>
            ))}
          </select>
          {lastSynced && (
            <small style={{ color: '#9ca3af' }}>
              Last synced: {new Date(lastSynced).toLocaleString()}
            </small>
          )}
        </div>
      )}
    </div>
  )
}
