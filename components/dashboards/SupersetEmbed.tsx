'use client'

import { useEffect, useRef } from 'react'

interface SupersetEmbedProps {
  embedUuid: string
  guestToken: string
  supersetUrl: string
}

export function SupersetEmbed({ embedUuid, guestToken, supersetUrl }: SupersetEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const embeddedRef = useRef<{ unmount?: () => void } | null>(null)

  useEffect(() => {
    if (!containerRef.current || !guestToken || !embedUuid) return

    let cancelled = false

    async function mount() {
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
