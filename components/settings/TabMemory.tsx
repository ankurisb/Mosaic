'use client'
import { useEffect, useState } from 'react'
import { PageTitle, PageSub, Card, INP, Btn, Badge, Spinner, Alert } from './ui'

interface Mem { id: string; project: string | null; category: string; content: string; source: string; updated_at: string }
const CATS = ['preference', 'fact', 'project'] as const
const CAT_LABEL: Record<string, string> = { preference: 'Preference', fact: 'Fact', project: 'Project context' }
const CAT_SHORT: Record<string, string> = { preference: 'Preference', fact: 'Fact', project: 'Project' }
const CAT_COLOR: Record<string, 'blue' | 'green' | 'amber'> = { preference: 'blue', fact: 'green', project: 'amber' }

export default function TabMemory() {
  const [mems, setMems] = useState<Mem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<string>('fact')
  const [project, setProject] = useState('')
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  async function load() {
    setLoading(true)
    try { const r = await fetch('/api/memory'); const d = await r.json(); setMems(d.memories || []) }
    catch { setErr('Could not load memory.') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function add() {
    if (!content.trim()) return
    setSaving(true); setErr('')
    try {
      const r = await fetch('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, category, project: project || null }) })
      const d = await r.json()
      if (!r.ok || d.ok === false) { setErr(d.reason || d.error || 'Could not save.'); return }
      setContent(''); setProject(''); await load()
    } finally { setSaving(false) }
  }
  async function del(id: string) {
    await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); await load()
  }
  async function saveEdit(id: string) {
    await fetch('/api/memory', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, content: editText }) })
    setEditId(null); await load()
  }

  // Segmented category selector — shows all options at once rather than hiding
  // them in a dropdown, so the choice reads at a glance.
  const Segmented = () => (
    <div style={{ display: 'inline-flex', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2, gap: 2 }}>
      {CATS.map(c => {
        const on = category === c
        return (
          <button key={c} onClick={() => setCategory(c)} type="button"
            style={{ padding: '5px 12px', fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 'calc(var(--radius-sm) - 2px)', border: '1px solid ' + (on ? 'var(--border)' : 'transparent'), background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--text)' : 'var(--text3)', fontWeight: on ? 600 : 500, boxShadow: on ? 'var(--shadow)' : 'none', transition: 'all .12s' }}>
            {CAT_SHORT[c]}
          </button>
        )
      })}
    </div>
  )

  return (
    <div>
      <PageTitle>Memory</PageTitle>
      <PageSub>Durable facts Mosaic remembers about you across conversations. Only you can see or change these; they are never shared with other users. Avoid storing secrets, credentials, ID numbers, or health details.</PageSub>

      {/* Composer */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Remember that…  e.g. “I manage Line A and care most about OEE and downtime.”"
            rows={2} style={{ ...INP, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Segmented />
            <input value={project} onChange={e => setProject(e.target.value)} placeholder="Project tag (optional)" style={{ ...INP, width: 190 }} />
            <div style={{ flex: 1 }} />
            <Btn variant="primary" onClick={add} disabled={saving || !content.trim()}>{saving ? 'Saving…' : 'Add memory'}</Btn>
          </div>
          {err && <Alert variant="error">{err}</Alert>}
        </div>
      </Card>

      {/* Saved memories */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 2px 12px' }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Saved memories</span>
        {!loading && mems.length > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '1px 8px' }}>{mems.length}</span>
        )}
      </div>

      {loading ? (
        <div style={{ color: 'var(--text3)', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', padding: '8px 2px' }}><Spinner /> Loading…</div>
      ) : mems.length === 0 ? (
        <div style={{ border: '1px dashed var(--border2)', borderRadius: 'var(--radius)', padding: '28px 20px', textAlign: 'center', color: 'var(--text3)' }}>
          <div style={{ fontSize: 22, marginBottom: 8, opacity: 0.6 }}>🔖</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 3 }}>Nothing remembered yet</div>
          <div style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>Add one above, or just tell Mosaic “remember…” in a chat.</div>
        </div>
      ) : (
        CATS.filter(c => mems.some(m => m.category === c)).map(cat => (
          <div key={cat} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text3)', marginBottom: 8 }}>{CAT_LABEL[cat]}</div>
            <Card style={{ marginBottom: 0 }}>
              <div style={{ padding: '2px 16px' }}>
                {mems.filter(m => m.category === cat).map((m, i, arr) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ marginTop: 1 }}><Badge label={CAT_LABEL[m.category]} color={CAT_COLOR[m.category] || 'gray'} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editId === m.id ? (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input value={editText} onChange={e => setEditText(e.target.value)} style={{ ...INP, flex: 1 }} autoFocus />
                          <Btn size="sm" variant="primary" onClick={() => saveEdit(m.id)}>Save</Btn>
                          <Btn size="sm" variant="secondary" onClick={() => setEditId(null)}>Cancel</Btn>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.55 }}>{m.content}</div>
                          {m.project && <span style={{ fontSize: 11, color: 'var(--text3)' }}>#{m.project}</span>}
                        </>
                      )}
                    </div>
                    {editId !== m.id && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <Btn size="sm" variant="secondary" onClick={() => { setEditId(m.id); setEditText(m.content) }}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => del(m.id)}>Delete</Btn>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ))
      )}
    </div>
  )
}
