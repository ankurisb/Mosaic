'use client'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import AppShell from '@/components/AppShell'

function fmtDate(s: unknown) {
  if (!s) return '—'
  try { return new Date(String(s)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return String(s) }
}

export default function DigestViewer({ user, instance, id }: { user: SessionUser; instance: Record<string, unknown> | null; id: string }) {
  const router = useRouter()
  const name = instance ? String(instance.name) : 'Report'
  const hasPdf = instance && instance.pdf_path && instance.status !== 'failed'

  return (
    <AppShell user={user}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {/* Header bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
          <button onClick={() => router.push('/reports')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M7.5 2.5L4 6l3.5 3.5" /></svg>
            Back to Digests
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text3)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {instance?.template_name ? <span>{String(instance.template_name)}</span> : <span>From chat</span>}
              <span>{fmtDate(instance?.generated_at)}</span>
              {instance?.trigger ? <span>· {String(instance.trigger)}</span> : null}
            </div>
          </div>
          {hasPdf && (
            <a href={`/api/reports/download?id=${id}`} download
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 12.5, fontWeight: 500, textDecoration: 'none', fontFamily: 'inherit' }}>
              Download PDF
            </a>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, background: 'var(--bg2, var(--bg))' }}>
          {!instance ? (
            <Center>Report not found.</Center>
          ) : instance.status === 'failed' ? (
            <Center>This run failed{instance.error ? `: ${String(instance.error)}` : '.'}</Center>
          ) : !instance.pdf_path ? (
            <Center>No output is available for this run yet.</Center>
          ) : (
            <iframe title={name} src={`/api/reports/download?id=${id}&inline=1`}
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
          )}
        </div>
      </div>
    </AppShell>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13, padding: 40, textAlign: 'center' }}>{children}</div>
}
