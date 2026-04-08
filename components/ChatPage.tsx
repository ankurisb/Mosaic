'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import ThemeToggle from './ThemeToggle'

interface ToolCall { name: string; input: unknown; result?: unknown }
interface Message { role: 'user' | 'assistant'; content: string; tools?: ToolCall[] }
interface Conv { id: string; title: string; messages: Message[] }

const SUGGESTIONS = [
  { icon: '🔍', label: 'Search the web', prompt: 'Search the web for the latest AI news' },
  { icon: '🗄️', label: 'Database', prompt: 'What databases do I have connected?' },
  { icon: '🌐', label: 'Call an API', prompt: 'What API connections do I have?' },
  { icon: '✍️', label: 'Write something', prompt: 'Write a professional email template for a product launch' },
]

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
  const taRef = useRef<HTMLTextAreaElement>(null)

  const active = convs.find(c => c.id === activeId) || convs[0]
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [active?.messages])

  function newConv() {
    const id = Date.now().toString()
    setConvs(p => [{ id, title: 'New conversation', messages: [] }, ...p])
    setActiveId(id)
  }

  function delConv(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setConvs(p => {
      const next = p.filter(c => c.id !== id)
      if (!next.length) { const nid = Date.now().toString(); setActiveId(nid); return [{ id: nid, title: 'New conversation', messages: [] }] }
      if (activeId === id) setActiveId(next[0].id)
      return next
    })
  }

  function updateLast(cid: string, fn: (m: Message) => Message) {
    setConvs(p => p.map(c => {
      if (c.id !== cid) return c
      const msgs = [...c.messages]; msgs[msgs.length - 1] = fn(msgs[msgs.length - 1])
      return { ...c, messages: msgs }
    }))
  }

  async function send(text: string) {
    if (!text.trim() || streaming) return
    const cid = activeId
    setConvs(p => p.map(c => {
      if (c.id !== cid) return c
      return { ...c, title: c.messages.length === 0 ? text.slice(0, 42) : c.title, messages: [...c.messages, { role: 'user', content: text }, { role: 'assistant', content: '', tools: [] }] }
    }))
    setInput(''); setStreaming(true)
    if (taRef.current) { taRef.current.style.height = 'auto' }
    const history = [...(active?.messages || []), { role: 'user' as const, content: text }]
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map(m => ({ role: m.role, content: m.content })), system: systemPrompt }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Request failed')
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const e = JSON.parse(line.slice(6))
            if (e.type === 'text') updateLast(cid, m => ({ ...m, content: m.content + e.text }))
            else if (e.type === 'tool_start') updateLast(cid, m => ({ ...m, tools: [...(m.tools || []), { name: e.name, input: e.input }] }))
            else if (e.type === 'tool_result') updateLast(cid, m => {
              const tools = [...(m.tools || [])]
              for (let i = tools.length - 1; i >= 0; i--) { if (tools[i].name === e.name && tools[i].result === undefined) { tools[i] = { ...tools[i], result: e.result }; break } }
              return { ...m, tools }
            })
            else if (e.type === 'error') updateLast(cid, m => ({ ...m, content: 'Error: ' + e.message }))
          } catch {}
        }
      }
    } catch (err) { updateLast(cid, m => ({ ...m, content: 'Error: ' + (err instanceof Error ? err.message : 'Something went wrong') })) }
    finally { setStreaming(false) }
  }

  async function signOut() {
    await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signout' }) })
    router.push('/login')
  }

  const isLastStreaming = (i: number) => streaming && i === active.messages.length - 1

  const toolLabel: Record<string, string> = { web_search: '🔍 Web search', query_database: '🗄 Database query', call_api: '🌐 API call' }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* ── Sidebar ── */}
      <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRight: '1px solid var(--border)' }}>

        {/* Logo */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 15, color: 'var(--text)' }}>claude app</span>
            <span style={{ fontSize: 10, color: 'var(--text4)', background: 'var(--bg3)', padding: '1px 6px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)' }}>v1.0.0</span>
          </div>
          <button onClick={newConv} title="New conversation"
            style={{ width: 28, height: 28, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border2)', background: 'var(--bg)', cursor: 'pointer', fontSize: 16, color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)', lineHeight: 1 }}>+</button>
        </div>

        {/* Conversations */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
          {convs.map(c => (
            <div key={c.id} onClick={() => setActiveId(c.id)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', marginBottom: 2, background: c.id === activeId ? 'var(--bg3)' : 'transparent', border: `1px solid ${c.id === activeId ? 'var(--border2)' : 'transparent'}`, transition: 'background .12s' }}>
              <span style={{ fontSize: 12, color: c.id === activeId ? 'var(--text)' : 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.title}</span>
              <button onClick={e => delConv(c.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', fontSize: 15, paddingLeft: 6, flexShrink: 0, opacity: 0.6 }}>×</button>
            </div>
          ))}
        </div>

        {/* Footer nav */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px' }}>
          <button onClick={() => router.push('/settings')}
            style={{ width: '100%', padding: '8px 10px', background: 'none', border: '1px solid transparent', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12, color: 'var(--text2)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', transition: 'background .12s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            ⚙ Settings
          </button>
        </div>

        {/* User + theme */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <button onClick={() => setShowUserMenu(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', width: '100%' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg4)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text2)', flexShrink: 0 }}>
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ textAlign: 'left', overflow: 'hidden', flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.role}</div>
              </div>
            </button>
            {showUserMenu && (
              <>
                <div onClick={() => setShowUserMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', padding: 6, width: 200, zIndex: 50 }}>
                  <div style={{ padding: '8px 10px', fontSize: 12, borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                    <div style={{ fontWeight: 500, color: 'var(--text)', marginBottom: 1 }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{user.email}</div>
                  </div>
                  {[
                    { label: '⚙ Settings', action: () => { setShowUserMenu(false); router.push('/settings') } },
                    { label: '← Sign out', action: () => { setShowUserMenu(false); signOut() } },
                  ].map(item => (
                    <button key={item.label} onClick={item.action}
                      style={{ width: '100%', padding: '8px 10px', background: 'none', border: 'none', fontSize: 12, color: 'var(--text2)', cursor: 'pointer', textAlign: 'left', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                      {item.label}
                    </button>
                  ))}
                  <div style={{ padding: '7px 10px', borderTop: '1px solid var(--border)', marginTop: 4, fontSize: 10, color: 'var(--text4)' }}>
                    claude app v1.0.0 · ugx.ai
                  </div>
                </div>
              </>
            )}
          </div>
          <ThemeToggle />
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* System prompt */}
        <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
          <button onClick={() => setShowSystem(v => !v)}
            style={{ width: '100%', background: 'none', border: 'none', padding: '8px 20px', fontSize: 11, color: 'var(--text3)', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            <span style={{ display: 'inline-block', transition: 'transform .15s', transform: showSystem ? 'rotate(90deg)' : 'none', fontSize: 9 }}>▶</span>
            System prompt
            {systemPrompt && <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--blue-t)', letterSpacing: 0 }}>· active</span>}
          </button>
          {showSystem && (
            <div style={{ padding: '0 20px 12px' }}>
              <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={3}
                placeholder="You are a helpful assistant…"
                style={{ width: '100%', resize: 'none', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 0' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 32px' }}>
            {active.messages.length === 0 ? (
              <div className="fade-in">
                <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 400, color: 'var(--text)', marginBottom: 8 }}>What can I help with?</h1>
                <p style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 32 }}>Powered by Claude · Web search · Database & API queries</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 340 }}>
                  {SUGGESTIONS.map(s => (
                    <button key={s.label} onClick={() => send(s.prompt)}
                      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontSize: 14, color: 'var(--text)', fontFamily: 'inherit', fontWeight: 500, textAlign: 'left', boxShadow: 'var(--shadow)', transition: 'box-shadow .15s, transform .1s' }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow)'; e.currentTarget.style.transform = 'none' }}>
                      <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{s.icon}</span>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              active.messages.map((msg, i) => (
                <div key={i} className="fade-in" style={{ marginBottom: 28 }}>
                  {/* Role label */}
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>
                    {msg.role === 'user' ? 'You' : 'Claude'}
                  </div>

                  {/* Tool calls */}
                  {msg.tools?.map((tc, j) => (
                    <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 10, fontSize: 12 }}>
                      <span style={{ color: 'var(--text2)', fontWeight: 500, flexShrink: 0 }}>{toolLabel[tc.name] || `⚙ ${tc.name}`}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: 'var(--text3)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{JSON.stringify(tc.input)}</div>
                        {tc.result !== undefined && (
                          <div style={{ color: 'var(--green-t)', fontSize: 11, marginTop: 4 }}>
                            ✓ {JSON.stringify(tc.result).slice(0, 180)}{JSON.stringify(tc.result).length > 180 ? '…' : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Message bubble */}
                  {msg.role === 'user' ? (
                    <div style={{ display: 'inline-block', background: 'var(--bg4)', borderRadius: 'var(--radius)', padding: '10px 16px', fontSize: 14, color: 'var(--text)', lineHeight: 1.7, maxWidth: '80%' }}>
                      {msg.content}
                    </div>
                  ) : (
                    <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                      {msg.content}
                      {isLastStreaming(i) && (
                        <span style={{ display: 'inline-block', width: 2, height: 16, background: 'var(--text)', marginLeft: 2, verticalAlign: 'middle', animation: 'blink 1s step-end infinite', borderRadius: 1 }} />
                      )}
                    </div>
                  )}

                  {/* Follow-up suggestions */}
                  {msg.role === 'assistant' && i === active.messages.length - 1 && !streaming && msg.content && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                      {['Go deeper', 'Simplify this', 'Give examples', 'What next?'].map(label => (
                        <button key={label} onClick={() => send(label)}
                          style={{ padding: '5px 13px', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', fontSize: 12, color: 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--shadow)', transition: 'background .12s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface)')}>
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
        </div>

        {/* Input bar */}
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)', padding: '14px 24px 18px', flexShrink: 0 }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-lg)', padding: '10px 12px', boxShadow: 'var(--shadow)' }}>
              <textarea ref={taRef} value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px' }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
                placeholder="Message… (Enter to send, Shift+Enter for new line)"
                rows={1}
                style={{ flex: 1, resize: 'none', background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: 'var(--text)', lineHeight: 1.6, fontFamily: 'inherit' }} />
              <button onClick={() => send(input)} disabled={streaming || !input.trim()}
                style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', border: 'none', background: streaming || !input.trim() ? 'var(--bg4)' : 'var(--accent-bg)', color: streaming || !input.trim() ? 'var(--text4)' : 'var(--accent-fg)', cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, transition: 'background .15s', boxShadow: streaming || !input.trim() ? 'none' : 'var(--shadow)' }}>
                {streaming ? <span style={{ display: 'inline-block', width: 14, height: 14, border: '1.5px solid var(--text4)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} /> : '↑'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text4)', textAlign: 'center', marginTop: 8 }}>
              Claude may make mistakes. Verify important information.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
