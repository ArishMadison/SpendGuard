import { useEffect, useState } from 'react'
import { metaOAuthExchange } from '../lib/api.js'

/**
 * OAuth callback page — opened as a popup by WorkspaceDetail.
 * Meta redirects here with ?code=XXX after user authorizes.
 * This page exchanges the code, then postMessages the result back to the opener and closes.
 */
export default function OAuthMetaCallback() {
  const [status, setStatus] = useState('Connecting to Meta...')
  const [error, setError]   = useState(null)

  useEffect(() => {
    handleCallback()
  }, [])

  async function handleCallback() {
    const params           = new URLSearchParams(window.location.search)
    const code             = params.get('code')
    const oauthError       = params.get('error')
    const oauthErrorDesc   = params.get('error_description')

    if (oauthError) {
      const msg = oauthErrorDesc || oauthError
      setError(msg)
      postToOpener({ type: 'meta_oauth_error', error: msg })
      return
    }

    if (!code) {
      const msg = 'No authorization code returned from Meta.'
      setError(msg)
      postToOpener({ type: 'meta_oauth_error', error: msg })
      return
    }

    setStatus('Exchanging authorization code...')

    try {
      const redirectUri = `${window.location.origin}/oauth/meta/callback`
      const data = await metaOAuthExchange({ code, redirect_uri: redirectUri })
      if (data?.error) throw new Error(data.error)

      setStatus(`Found ${data.ad_accounts?.length ?? 0} ad account(s). Closing...`)

      postToOpener({
        type:         'meta_oauth_success',
        access_token: data.access_token,
        ad_accounts:  data.ad_accounts,
      })

    } catch (err) {
      setError(err.message)
      postToOpener({ type: 'meta_oauth_error', error: err.message })
    }
  }

  function postToOpener(message) {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(message, window.location.origin)
    }
    setTimeout(() => window.close(), 1500)
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '0.75rem',
      fontFamily: 'system-ui, sans-serif',
    }}>
      {error ? (
        <>
          <div style={{ fontSize: '1.25rem' }}>⚠️</div>
          <div style={{ fontWeight: 600, color: '#dc2626' }}>Connection failed</div>
          <div style={{ color: '#6b7280', fontSize: '0.875rem', maxWidth: 320, textAlign: 'center' }}>{error}</div>
          <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>You can close this window.</div>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 600, color: '#111827' }}>{status}</div>
          <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>This window will close automatically.</div>
        </>
      )}
    </div>
  )
}
