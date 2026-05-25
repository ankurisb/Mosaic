'use client'
import { useState, useEffect, useCallback } from 'react'
import { PageTitle, PageSub, Btn, Spinner, Alert, SectionLabel } from './ui'
import { safeJson } from '@/lib/fetch'

interface Archive {
  name: string
  size: number
  size_human: string
  created_at: string
}

interface BackupData {
  status: 'ok' | 'running' | 'error' | 'unknown'
  last_backup_at: string | null
  last_archive: string | null
  archive_size?: string
  total_archives?: number
  duration_seconds?: number
  next_backup_at?: string | null
  error: string | null
  schedule_hours: number
  keep_count: number
  archives: Archive[]
}

const SCHEDULE_OPTIONS = [
  { label: 'Every 6 hours',  value: 6  },
  { label: 'Every 12 hours', value: 12 },
  { label: 'Every 24 hours', value: 24 },
  { label: 'Every 48 hours', value: 48 },
]

const KEEP_OPTIONS = [
  { label: '7 archives  (~1 week daily)',   value: 7  },
  { label: '14 archives (~2 weeks daily)',  value: 14 },
  { label: '30 archives (~1 month daily)',  value: 30 },
  { label: '60 archives (~2 months daily)', value: 60 },
]

export default function TabBackup() {
  const [data,         setData]         = useState<BackupData | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [triggering,   setTriggering]   = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [toast,        setToast]        = useState('')
  const [schedHours,   setSchedHours]   = useState(24)
  const [keepCount,    setKeepCount]    = useState(30)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/backup')
      const { data: d, error } = await safeJson<BackupData>(r)
      if (error || !d) return
      setData(d)
      setSchedHours(d.schedule_hours || 24)
      setKeepCount(d.keep_count || 30)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Poll every 5s while a backup is running
  useEffect(() => {
    if (data?.status !== 'running') return
    const t = setTimeout(load, 5000)
    return () => clearTimeout(t)
  }, [data?.status, load])

  async function triggerNow() {
    setTriggering(true)
    try {
      const r = await fetch('/api/backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger' }),
      })
      const { data: d, error } = await safeJson<{ ok?: boolean; message?: string }>(r)
      if (error) { setToast('Error: ' + error); return }
      setToast(d?.message || 'Backup triggered')
      setTimeout(load, 3000) // reload after 3s to show running state
    } finally { setTriggering(false) }
  }

  async function saveConfig() {
    setSaving(true)
    try {
      const r = await fetch('/api/backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_config', schedule_hours: schedHours, keep_count: keepCount }),
      })
      const { error } = await safeJson(r)
      if (error) { setToast('Error: ' + error); return }
      setToast('Settings saved')
      load()
    } finally { setSaving(false) }
  }

  const statusColor = !data ? 'var(--text3)'
    : data.status === 'ok'      ? 'var(--green-t)'
    : data.status === 'running' ? 'var(--amber-t)'
    : data.status === 'unknown' ? 'var(--amber-t)'
    : 'var(--red-t)'

  const statusLabel = !data ? '—'
    : data.status === 'ok'      ? 'Running'
    : data.status === 'running' ? 'Backup in progress...'
    : data.status === 'unknown' ? 'Sidecar not started'
    : 'Error'

  const sel: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
    padding: '6px 10px', fontSize: 13, color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer', minWidth: 200,
  }

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageTitle>Backup &amp; restore</PageTitle>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {loading && <Spinner />}
          <Btn size="sm" onClick={load}>Refresh</Btn>
        </div>
      </div>
      <PageSub>Automated backups of all Mosaic data. Backups are stored on the server in the <code style={{ fontSize: 11, background: 'var(--bg3)', padding: '1px 5px', borderRadius: 4 }}>./backups/</code> directory.</PageSub>

      {toast && (
        <div style={{ marginBottom: 16 }}>
          <Alert variant={toast.startsWith('Error') ? 'error' : 'success'}>
            {toast} <button onClick={() => setToast('')} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: .6, fontSize: 12 }}>✕</button>
          </Alert>
        </div>
      )}

      {/* ── Status card ────────────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 24 }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0, display: 'inline-block', boxShadow: data?.status === 'running' ? `0 0 0 3px ${statusColor}33` : 'none' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Automated backup</span>
            <span style={{ fontSize: 12, color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
          </div>
          <Btn
            variant="primary" size="sm"
            onClick={triggerNow}
            disabled={triggering || data?.status === 'running' || data?.status === 'unknown'}
          >
            {triggering || data?.status === 'running'
              ? <><Spinner />&nbsp;Running...</>
              : '↓ Run backup now'}
          </Btn>
        </div>

        {/* Stats row */}
        {[
          { label: 'Last backup',   value: data?.last_backup_at ? fmtDate(data.last_backup_at) : '—' },
          { label: 'Last archive',  value: data?.last_archive || '—' },
          { label: 'Archive size',  value: data?.archive_size || '—' },
          { label: 'Total archives',value: data?.total_archives != null ? String(data.total_archives) : '—' },
          { label: 'Duration',      value: data?.duration_seconds != null ? `${data.duration_seconds}s` : '—' },
          { label: 'Next backup',   value: data?.next_backup_at ? fmtDate(data.next_backup_at) : '—' },
        ].map((item, i, arr) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', padding: '11px 20px', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text4)', textTransform: 'uppercase' as const, letterSpacing: '.07em', width: 120, flexShrink: 0 }}>{item.label}</span>
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>{item.value}</span>
          </div>
        ))}

        {/* Error row */}
        {data?.status === 'error' && data.error && (
          <div style={{ padding: '12px 20px', background: 'var(--red-bg, rgba(239,68,68,.06))', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--red-t)' }}>{data.error}</span>
          </div>
        )}
        {data?.status === 'unknown' && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
              Backup sidecar is not running. Start it with <code style={{ fontSize: 11, background: 'var(--bg3)', padding: '1px 5px', borderRadius: 4 }}>docker compose up -d</code>
            </span>
          </div>
        )}
      </div>

      {/* ── Schedule & retention settings ──────────────────────────── */}
      <SectionLabel>Schedule &amp; retention</SectionLabel>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' as const }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.07em', marginBottom: 6 }}>Backup frequency</div>
            <select value={schedHours} onChange={e => setSchedHours(Number(e.target.value))} style={sel}>
              {SCHEDULE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.07em', marginBottom: 6 }}>Archives to keep</div>
            <select value={keepCount} onChange={e => setKeepCount(Number(e.target.value))} style={sel}>
              {KEEP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ paddingTop: 20 }}>
            <Btn variant="primary" size="sm" onClick={saveConfig} disabled={saving}>
              {saving ? <Spinner /> : 'Save'}
            </Btn>
          </div>
        </div>
        <div style={{ padding: '10px 20px' }}>
          <span style={{ fontSize: 11, color: 'var(--text4)' }}>
            Changes apply immediately — the sidecar picks them up within 10 seconds without a restart.
            To change the backup storage location, update <code style={{ fontSize: 10, background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>BACKUP_DIR</code> in your <code style={{ fontSize: 10, background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>.env</code> and restart the backup container.
          </span>
        </div>
      </div>

      {/* ── Archive list ────────────────────────────────────────────── */}
      <SectionLabel>Archives <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text4)' }}>({data?.archives?.length ?? 0} stored)</span></SectionLabel>
      {!data?.archives?.length ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px 20px', color: 'var(--text3)', fontSize: 13, textAlign: 'center' as const }}>
          {data?.status === 'unknown' ? 'No archives yet — start the backup sidecar with docker compose up -d'
            : 'No archives yet — the first backup will run automatically at the next scheduled time, or click "Run backup now".'}
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 140px', gap: 12, padding: '8px 20px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
            {['Archive', 'Size', 'Created'].map(h => (
              <span key={h} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text4)', textTransform: 'uppercase' as const, letterSpacing: '.07em' }}>{h}</span>
            ))}
          </div>
          {data.archives.map((a, i) => (
            <div key={a.name} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 140px', gap: 12, padding: '11px 20px', borderBottom: i < data.archives.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                {i === 0 && <span style={{ fontSize: 10, background: 'var(--green-bg, rgba(34,197,94,.1))', color: 'var(--green-t)', padding: '1px 6px', borderRadius: 99, marginRight: 6, fontFamily: 'var(--font-sans)', fontWeight: 600 }}>latest</span>}
                {a.name}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>{a.size_human}</span>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>{fmtDate(a.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Restore instructions ────────────────────────────────────── */}
      <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>Restoring from a backup</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.7 }}>
          To restore, run on the server: <code style={{ fontSize: 11, background: 'var(--surface)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 4 }}>bash scripts/restore.sh backups/mosaic-backup-YYYYMMDD-HHMMSS.tar.gz</code>
          <br />Archives are stored in <code style={{ fontSize: 11, background: 'var(--surface)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 4 }}>./backups/</code> relative to the Mosaic installation directory. See <a href="/docs/updating" style={{ color: 'var(--blue-t)', textDecoration: 'none' }}>Updating guide</a> for full restore steps.
        </div>
      </div>
    </div>
  )
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return iso }
}
