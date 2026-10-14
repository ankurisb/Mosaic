'use client'
import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import type { MapArtifact as MapData } from '@/lib/tools'

function esc(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)) }

// Interactive map rendered with Leaflet (vector circle markers — no image
// assets, so no broken-icon issues). Degrades gracefully: if Leaflet fails to
// load/init it falls back to a location list; if map tiles can't be fetched
// (air-gapped install) the markers still render on a plain background and an
// "offline basemap" note appears.
export default function MapArtifact({ data }: { data: MapData }) {
  const ref = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const [offline, setOffline] = useState(false)
  const points = data.points || []
  const key = `${points.length}:${data.title || ''}:${points[0]?.lat},${points[0]?.lng}`

  useEffect(() => {
    let map: import('leaflet').Map | null = null
    let cancelled = false
    ;(async () => {
      try {
        const L = (await import('leaflet')).default
        if (cancelled || !ref.current) return
        map = L.map(ref.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: true })
        const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' })
        let errs = 0
        tiles.on('tileerror', () => { if (++errs >= 3 && !cancelled) setOffline(true) })
        tiles.addTo(map)
        const latlngs: [number, number][] = []
        for (const p of points) {
          latlngs.push([p.lat, p.lng])
          const m = L.circleMarker([p.lat, p.lng], { radius: 7, color: '#1d4ed8', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.7 })
          const parts: string[] = []
          if (p.label) parts.push(`<strong>${esc(p.label)}</strong>`)
          if (p.detail) parts.push(esc(p.detail))
          if (p.value != null) parts.push(`<span style="color:#1d4ed8">${esc(String(p.value))}</span>`)
          if (parts.length) m.bindPopup(parts.join('<br>'))
          m.addTo(map!)
        }
        if (data.center) map.setView([data.center.lat, data.center.lng], data.zoom || 10)
        else if (latlngs.length === 1) map.setView(latlngs[0], data.zoom || 12)
        else map.fitBounds(latlngs, { padding: [32, 32] })
        // Leaflet needs a size recalculation once the panel has laid out.
        setTimeout(() => { try { map?.invalidateSize() } catch {} }, 60)
      } catch { if (!cancelled) setFailed(true) }
    })()
    return () => { cancelled = true; if (map) { try { map.remove() } catch {} } }
  }, [key])  // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    // Graceful fallback: a plain, scrollable location list.
    return (
      <div style={{ height: '100%', overflow: 'auto', padding: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>Map view unavailable — showing locations as a list.</div>
        {points.map((p, i) => (
          <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>{p.label || `Point ${i + 1}`}</div>
            {p.detail && <div style={{ color: 'var(--text2)' }}>{p.detail}</div>}
            <div style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{p.lat.toFixed(5)}, {p.lng.toFixed(5)}{p.value != null ? ` · ${p.value}` : ''}</div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div ref={ref} style={{ height: '100%', width: '100%', background: 'var(--bg3)' }} />
      {offline && (
        <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 500, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 11, color: 'var(--text3)' }}>
          Offline — basemap unavailable; markers shown.
        </div>
      )}
    </div>
  )
}
