'use client'

import { useEffect, useRef } from 'react'

interface SupersetEmbedProps {
  embedUuid: string
  guestToken: string
  supersetUrl: string
  onError?: (message: string) => void
}

export function SupersetEmbed({ embedUuid, guestToken, supersetUrl, onError }: SupersetEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const embeddedRef = useRef<{ unmount?: () => void } | null>(null)

  useEffect(() => {
    if (!containerRef.current || !guestToken || !embedUuid) return

    let cancelled = false

    // Mixed content: a browser on an https page silently refuses to load an http
    // iframe/resource. If Mosaic is served over https but the Superset public URL
    // is http, the embed will never render — detect it up front and report a
    // clear reason instead of a blank frame.
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && /^http:\/\//i.test(supersetUrl)) {
      onError?.('Your Superset URL is http:// but Mosaic is served over https, so the browser blocks the embed (mixed content). Set the Superset public URL to an https address (e.g. behind the reverse proxy), or open the dashboard in Superset directly.')
      return
    }

    async function mount() {
      try {
        const { embedDashboard } = await import('@superset-ui/embedded-sdk')
        if (cancelled || !containerRef.current) return

        embeddedRef.current = await embedDashboard({
          id: embedUuid,
          supersetDomain: supersetUrl,
          mountPoint: containerRef.current,
          fetchGuestToken: () => Promise.resolve(guestToken),
          dashboardUiConfig: {
            hideTitle: true,
            hideChartControls: false,
            hideTab: false,
            filters: { visible: false, expanded: false },
          },
        })

        // Force the SDK-injected iframe to fill the container
        if (containerRef.current) {
          const iframe = containerRef.current.querySelector('iframe')
          if (iframe) {
            iframe.style.width = '100%'
            iframe.style.height = '100%'
            iframe.style.minHeight = 'calc(100vh - 52px)'
            iframe.style.border = 'none'
          }
        }
      } catch (err) {
        if (!cancelled) onError?.(`Couldn\u2019t load the embedded dashboard: ${err instanceof Error ? err.message : 'unknown error'}. Check that Superset is reachable at ${supersetUrl} and that the dashboard is enabled for embedding.`)
      }
    }

    mount()

    return () => {
      cancelled = true
      embeddedRef.current?.unmount?.()
    }
  }, [embedUuid, guestToken, supersetUrl])

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        width: '100%',
        height: 'calc(100vh - 52px)',
        minHeight: 'calc(100vh - 52px)',
        overflow: 'hidden',
      }}
    />
  )
}
