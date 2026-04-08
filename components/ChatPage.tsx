'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'

interface ToolCall { name: string; input: unknown; result?: unknown }
interface Message { role: 'user' | 'assistant'; content: string; tools?: ToolCall[] }
interface Conv { id: string; title: string; messages: Message[] }

const SUGGESTIONS = [
  'Search the web for the latest AI news',
  'What can you help me with?',
  'Explain machine learning in simple terms',
  'Write a short poem about the ocean',
]

const S = {
  // Sidebar
  sidebar: { width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg2)', borderRight: '1px solid var(--border)', height: '100vh' } as React.CSSProperties,
  sidebarHead: { padding: '14px 12px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as React.CSSProperties,
  convItem: (active: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 8px', borderRadius: 5, cursor: 'pointer', marginBottom: 2, border: `1px solid ${active ? 'var(--border2)' : 'transparent'}`, background: active ? 'var(--bg3)' : 'none', fontSize: 11, color: active ? 'var(--text)' : 'var(--text2)' }),
  // Input
  input: { flex: 1, resize: 'none', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '9px 13px', fontSize: 13, color: 'var(--text)', outline: 'none', lineHeight: 1.6 } as React.CSSProperties,
  sendBtn: (disabled: boolean): React.CSSProperties => ({ flexShrink: 0, padding: '9px 18px', borderRadius: 8, border: 'none', background: disabled ? 'var(--border2)' : 'var(--text)', color: 'var(--bg)', fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 500 }),
}

export default function ChatPage({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [convs, setConvs] = useState<Conv[]>([{ id: '1', title: 'New conversation', messages: [] }])
  const [activeId, setActiveId] = useState('1')
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const active = convs.find(c => c.id === activeId) || convs[0]

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [active?.messages])

  function newConv() {
    const id = Date.now().toString()
    setConvs(p => [{ id, title: 'New conversation', messages: [] }, ...p])
    setActiveId(id)
  }

  function deleteConv(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setConvs(p => {
      const next = p.filter(c => c.id !== id)
      if (!next.length) {
        const nid = Date.now().toString()
        setActiveId(nid)
        return [{ id: nid, title: 'New conversation', messages: [] }]
      }
      if (activeId === id) setActiveId(next[0].id)
      return next
    })
  }

  function updateLastMsg(id: string, fn: (m: Message) => Message) {
    setConvs(p => p.map(c => {
      if (c.id !== id) return c
      const msgs = [...c.messages]
      msgs[msgs.length - 1] = fn(msgs[msgs.length - 1])
      return { ...c, messages: msgs }
    }))
  }

  async function send(text: string) {
    if (!text.trim() || streaming) return
    const cid = activeId
    const userMsg: Message = { role: 'user', content: text }
    const asstMsg: Message = { role: 'assistant', content: '', tools: [] }

    setConvs(p => p.map(c => {
      if (c.id !== cid) return c
      return { ...c, title: c.messages.length === 0 ? text.slice(0, 42) : c.title, messages: [...c.messages, userMsg, asstMsg] }
    }))
    setInput('')
    setStreaming(true)

    const history = [...(active?.messages || []), userMsg]

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map(m => ({ role: m.role, content: m.content })), system: systemPrompt }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Request failed')

      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const e = JSON.parse(line.slice(6))
            if (e.type === 'text') {
              updateLastMsg(cid, m => ({ ...m, content: m.content + e.text }))
            } else if (e.type === 'tool_start') {
              updateLastMsg(cid, m => ({ ...m, tools: [...(m.tools || []), { name: e.name, input: e.input }] }))
            } else if (e.type === 'tool_result') {
              updateLastMsg(cid, m => {
                const tools = [...(m.tools || [])]
                for (let i = tools.length - 1; i >= 0; i--) {
                  if (tools[i].name === e.name && !tools[i].result) { tools[i] = { ...tools[i], result: e.result }; break }
                }
                return { ...m, tools }
              })
            } else if (e.type === 'error') {
              updateLastMsg(cid, m => ({ ...m, content: 'Error: ' + e.message }))
            }
          } catch { /* skip bad lines */ }
        }
      }
    } catch (err) {
      updateLastMsg(cid, m => ({ ...m, content: 'Error: ' + (err instanceof Error ? err.message : 'Something went wrong') }))
    } finally {
      setStreaming(false)
    }
  }

  async function signOut() {
    await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signout' }) })
    router.push('/login')
  }

  const isLastStreaming = (i: number) => streaming && i === active.messages.length - 1

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <div style={S.sidebar}>
        <div style={S.sidebarHead}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>claude app</span>
            <span style={{ fontSize: 9, color: 'var(--text3)', padding: '1px 4px', borderRadius: 3, background: 'var(--bg3)', border: '1px solid var(--border)' }}>v1.0.0</span>
          </div>
          <button onClick={newConv} title="New chat"
            style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 5, padding: '2px 9px', fontSize: 16, cursor: 'pointer', color: 'var(--text2)', lineHeight: 1.4 }}>+</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
          {convs.map(c => (
            <div key={c.id} onClick={() => setActiveId(c.id)} style={S.convItem(c.id === activeId)}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.title}</span>
              <button onClick={e => deleteConv(c.id, e)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 14, paddingLeft: 4, flexShrink: 0 }}>×</button>
            </div>
          ))}
        </div>

        {/* User menu */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px', display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
          <div onClick={() => setShowUserMenu(v => !v)}
            style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg3)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, cursor: 'pointer', userSelect: 'none' }}>
            {user.name.slice(0, 2).toUpperCase()}
          </div>
          {showUserMenu && (
            <>
              <div onClick={() => setShowUserMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', right: 6, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: 4, width: 188, zIndex: 50 }}>
                <div style={{ padding: '8px 10px', fontSize: 11, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 500, color: 'var(--text)' }}>{user.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{user.email}</div>
                </div>
                <button onClick={signOut}
                  style={{ width: '100%', padding: '7px 10px', background: 'none', border: 'none', fontSize: 11, color: 'var(--text2)', cursor: 'pointer', textAlign: 'left', borderRadius: 4 }}>
                  Sign out
                </button>
                <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>
                  claude app v1.0.0 · ugx.ai
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* System prompt */}
        <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={() => setShowSystem(v => !v)}
            style={{ width: '100%', background: 'none', border: 'none', padding: '7px 16px', fontSize: 10, color: 'var(--text3)', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 5, letterSpacing: '.06em' }}>
            <span>{showSystem ? '▾' : '▸'}</span>
            <span style={{ textTransform: 'uppercase' }}>system prompt</span>
            {systemPrompt && <span style={{ color: 'var(--text2)' }}> · active</span>}
          </button>
          {showSystem && (
            <div style={{ padding: '0 14px 10px' }}>
              <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                placeholder="You are a helpful assistant…"
                rows={3}
                style={{ width: '100%', resize: 'none', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: 'var(--text)', outline: 'none' }} />
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          {active.messages.length === 0 ? (
            <div style={{ paddingTop: 60 }}>
              <div style={{ fontSize: 20, fontWeight: 500, marginBottom: 6 }}>What can I help with?</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 28 }}>Powered by Claude · Web search · ugx.ai</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => send(s)}
                    style={{ padding: '7px 14px', border: '1px solid var(--border2)', borderRadius: 20, background: 'var(--bg3)', fontSize: 11, color: 'var(--text2)', cursor: 'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            active.messages.map((msg, i) => (
              <div key={i} style={{ marginBottom: 24 }}>
                {/* Role label */}
                <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 5 }}>
                  {msg.role === 'user' ? 'you' : 'claude'}
                </div>

                {/* Tool calls */}
                {msg.tools?.map((tc, j) => (
                  <div key={j} style={{ background: 'var(--bg3)', borderLeft: '2px solid var(--border2)', borderRadius: '0 6px 6px 0', padding: '8px 12px', marginBottom: 6, fontSize: 11 }}>
                    <div style={{ color: 'var(--text2)', marginBottom: 2 }}>⚙ {tc.name}</div>
                    <div style={{ color: 'var(--text3)', fontSize: 10 }}>{JSON.stringify(tc.input)}</div>
                    {tc.result !== undefined && (
                      <div style={{ color: 'var(--green-t)', marginTop: 3, fontSize: 10 }}>
                        ✓ {JSON.stringify(tc.result).slice(0, 140)}{JSON.stringify(tc.result).length > 140 ? '…' : ''}
                      </div>
                    )}
                  </div>
                ))}

                {/* Message content */}
                <div style={{ fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: msg.role === 'user' ? 'var(--text2)' : 'var(--text)' }}>
                  {msg.content}
                  {msg.role === 'assistant' && isLastStreaming(i) && !msg.content && (
                    <span style={{ display: 'inline-block', width: 7, height: 13, background: 'var(--text)', marginLeft: 2, verticalAlign: 'middle', animation: 'blink 1s step-end infinite' }} />
                  )}
                  {msg.role === 'assistant' && isLastStreaming(i) && msg.content && (
                    <span style={{ display: 'inline-block', width: 7, height: 13, background: 'var(--text)', marginLeft: 2, verticalAlign: 'middle', animation: 'blink 1s step-end infinite' }} />
                  )}
                </div>

                {/* Follow-up suggestions after last assistant message */}
                {msg.role === 'assistant' && i === active.messages.length - 1 && !streaming && msg.content && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 12 }}>
                    {['Go deeper', 'Simplify this', 'Give examples', 'What should I do next?'].map(label => (
                      <button key={label} onClick={() => send(label)}
                        style={{ padding: '4px 11px', border: '1px solid var(--border2)', borderRadius: 14, background: 'none', fontSize: 10, color: 'var(--text3)', cursor: 'pointer' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px 18px', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={textRef}
              value={input}
              onChange={e => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
              placeholder="Message… (Enter to send, Shift+Enter for new line)"
              rows={1}
              style={S.input}
            />
            <button onClick={() => send(input)} disabled={streaming || !input.trim()} style={S.sendBtn(streaming || !input.trim())}>
              {streaming ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
