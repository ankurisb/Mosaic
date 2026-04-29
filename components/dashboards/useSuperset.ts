import { useEffect, useState } from 'react'

export interface SupersetStatus {
  configured: boolean
  url?: string
  reachable?: boolean
  role?: string
}

export function useSuperset() {
  const [status, setStatus] = useState<SupersetStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/superset/status')
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => setStatus({ configured: false }))
      .finally(() => setLoading(false))
  }, [])

  return { status, loading }
}
