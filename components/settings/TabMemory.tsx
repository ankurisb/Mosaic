'use client'
import { useEffect, useState } from 'react'
import { PageTitle, PageSub, Card, INP, SEL, Btn, Badge, Spinner, Alert } from './ui'

interface Mem { id: string; project: string | null; category: string; content: string; source: string; updated_at: string }
const CATS = ['preference', 'fact', 'project'] as const
const CAT_LABEL: Record<string, string> = { preference: 'Preference', fact: 'Fact', project: 'Project context' }
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

  return (
    <div>
      <PageTitle>Memory</PageTitle>
      <PageSub>Durable facts Mosaic remembers about you across conversations. Only you can see or change these; they are never shared with other users. Avoid storing secrets, credentials, ID numbers, or health details.</PageSub>

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Remember that… (one concise fact or preference)"
            rows={2} style={{ ...INP, resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...SEL, width: 170 }}>
              {CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
            <input value={project} onChange={e => setProject(e.target.value)} placeholder="Project tag (optional)" style={{ ...INP, width: 200 }} />
            <Btn onClick={add} disabled={saving || !content.trim()}>{saving ? 'Saving…' : 'Add memory'}</Btn>
          </div>
          {err && <Alert variant="error">{err}</Alert>}
        </div>
      </Card>

      <div style={{ marginTop: 20 }}>
        {loading ? <div style={{ color: 'var(--text3)', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading…</div>
          : mems.length === 0 ? <div style={{ color: 'var(--text3)', fontSize: 13, padding: '20px 0' }}>Nothing remembered yet. Add something above, or just tell Mosaic “remember…” in a chat.</div>
          : CATS.filter(c => mems.some(m => m.category === c)).map(cat => (
            <div key={cat} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text3)', marginBottom: 8 }}>{CAT_LABEL[cat]}</div>
              <Card>
                {mems.filter(m => m.category === cat).map((m, i, arr) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ marginTop: 2 }}><Badge label={CAT_LABEL[m.category]} color={CAT_COLOR[m.category] || 'gray'} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editId === m.id ? (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input value={editText} onChange={e => setEditText(e.target.value)} style={{ ...INP, flex: 1 }} autoFocus />
                          <Btn size="sm" onClick={() => saveEdit(m.id)}>Save</Btn>
                          <Btn size="sm" variant="secondary" onClick={() => setEditId(null)}>Cancel</Btn>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5 }}>{m.content}</div>
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
              </Card>
            </div>
          ))}
      </div>
    </div>
  )
}
