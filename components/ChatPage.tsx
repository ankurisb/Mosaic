'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'

interface ToolCall { name: string; input: unknown; result?: unknown }
interface Message { role:'user'|'assistant'; content:string; tools?: ToolCall[] }
interface Conv { id:string; title:string; messages:Message[] }

const CHIPS = [
  'Search latest AI news',
  'Query production DB for top customers',
  'Fetch last month Stripe revenue',
  'Cross-reference HubSpot leads with our DB',
]

export default function ChatPage({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [convs, setConvs] = useState<Conv[]>([{ id:'1', title:'New conversation', messages:[] }])
  const [activeId, setActiveId] = useState('1')
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [showSources, setShowSources] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const active = convs.find(c => c.id === activeId) || convs[0]
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }) }, [active?.messages])

  function newConv() {
    const id = Date.now().toString()
    setConvs(p => [{ id, title:'New conversation', messages:[] }, ...p])
    setActiveId(id)
  }

  function delConv(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setConvs(p => {
      const next = p.filter(c => c.id !== id)
      if (!next.length) { const nid = Date.now().toString(); setActiveId(nid); return [{ id:nid, title:'New conversation', messages:[] }] }
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
      return { ...c, title: c.messages.length === 0 ? text.slice(0, 40) : c.title, messages: [...c.messages, { role:'user', content:text }, { role:'assistant', content:'', tools:[] }] }
    }))
    setInput(''); setStreaming(true)
    if (taRef.current) taRef.current.style.height = 'auto'
    const history = [...(active?.messages || []), { role:'user' as const, content:text }]
    try {
      const res = await fetch('/api/chat', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ messages: history.map(m => ({ role:m.role, content:m.content })), system:systemPrompt }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Request failed')
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream:true })
        const lines = buf.split('\n\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'text') updateLast(cid, m => ({ ...m, content: m.content + ev.text }))
            else if (ev.type === 'tool_start') updateLast(cid, m => ({ ...m, tools: [...(m.tools||[]), { name:ev.name, input:ev.input }] }))
            else if (ev.type === 'tool_result') updateLast(cid, m => {
              const tools = [...(m.tools||[])]
              for (let i = tools.length-1; i >= 0; i--) { if (tools[i].name===ev.name && tools[i].result===undefined) { tools[i]={...tools[i], result:ev.result}; break } }
              return { ...m, tools }
            })
            else if (ev.type === 'error') updateLast(cid, m => ({ ...m, content:'Error: '+ev.message }))
          } catch {}
        }
      }
    } catch (err) { updateLast(cid, m => ({ ...m, content:'Error: '+(err instanceof Error ? err.message : 'Something went wrong') })) }
    finally { setStreaming(false) }
  }

  async function signOut() {
    await fetch('/api/auth', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ action:'signout' }) })
    router.push('/login')
  }

  const isLast = (i: number) => streaming && i === active.messages.length - 1

  // shared micro-styles
  const tbt: React.CSSProperties = { width:'100%', background:'none', border:'none', padding:'8px 16px', fontSize:10, color:'var(--text3)', cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:5, letterSpacing:'.06em', textTransform:'uppercase' }
  const sbtn: React.CSSProperties = { background:'none', border:'1px solid var(--border2)', borderRadius:5, padding:'3px 10px', fontSize:11, cursor:'pointer', color:'var(--text2)' }

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>

      {/* ── Sidebar ── */}
      <div style={{ width:220, flexShrink:0, display:'flex', flexDirection:'column', background:'var(--bg2)', borderRight:'1px solid var(--border)' }}>
        <div style={{ padding:'14px 12px 10px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
            <span style={{ fontSize:12, fontWeight:500, letterSpacing:'.04em' }}>claude app</span>
            <span style={{ fontSize:9, color:'var(--text3)', padding:'1px 5px', borderRadius:3, background:'var(--bg3)', border:'1px solid var(--border)' }}>v1.0.0</span>
          </div>
          <button onClick={newConv} style={{ background:'none', border:'1px solid var(--border2)', borderRadius:5, padding:'2px 9px', fontSize:16, cursor:'pointer', color:'var(--text2)', lineHeight:1.4 }}>+</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:6 }}>
          {convs.map(c => (
            <div key={c.id} onClick={() => setActiveId(c.id)}
              style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 8px', borderRadius:5, cursor:'pointer', marginBottom:2, border:`1px solid ${c.id===activeId?'var(--border2)':'transparent'}`, background:c.id===activeId?'var(--bg3)':'none', fontSize:11, color:c.id===activeId?'var(--text)':'var(--text2)' }}>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{c.title}</span>
              <button onClick={e=>delConv(c.id,e)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)', fontSize:13, paddingLeft:4 }}>×</button>
            </div>
          ))}
        </div>

        <div style={{ borderTop:'1px solid var(--border)', padding:'8px 10px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <button onClick={() => router.push('/settings')} style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--text3)', cursor:'pointer', padding:'4px 6px', borderRadius:5, border:'none', background:'none' }}>
            ⚙ Settings
          </button>
          <div style={{ position:'relative' }}>
            <div onClick={() => setShowUserMenu(v=>!v)}
              style={{ width:26, height:26, borderRadius:'50%', background:'var(--bg3)', border:'1px solid var(--border2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:500, cursor:'pointer', color:'var(--text2)' }}>
              {user.name.slice(0,2).toUpperCase()}
            </div>
            {showUserMenu && (
              <>
                <div onClick={() => setShowUserMenu(false)} style={{ position:'fixed', inset:0, zIndex:40 }}/>
                <div style={{ position:'absolute', bottom:'calc(100% + 8px)', right:0, background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:8, padding:4, width:200, zIndex:50, boxShadow:'0 4px 16px rgba(0,0,0,0.08)' }}>
                  <div style={{ padding:'8px 10px', fontSize:11, borderBottom:'1px solid var(--border)' }}>
                    <div style={{ fontWeight:500, color:'var(--text)', marginBottom:1 }}>{user.name}</div>
                    <div style={{ fontSize:10, color:'var(--text3)' }}>{user.email}</div>
                    <span style={{ fontSize:9, background:'var(--pbg)', color:'var(--pt)', padding:'1px 6px', borderRadius:8, marginTop:4, display:'inline-block' }}>{user.role}</span>
                  </div>
                  {[['⚙ Settings', ()=>{setShowUserMenu(false);router.push('/settings')}], ['Sign out', ()=>{setShowUserMenu(false);signOut()}]].map(([lbl,fn])=>(
                    <button key={String(lbl)} onClick={fn as ()=>void} style={{ width:'100%', padding:'7px 10px', background:'none', border:'none', fontSize:11, color:'var(--text2)', cursor:'pointer', textAlign:'left', borderRadius:4 }}>
                      {String(lbl)}
                    </button>
                  ))}
                  <div style={{ padding:'6px 10px', borderTop:'1px solid var(--border)', fontSize:9, color:'var(--text3)', marginTop:2 }}>claude app v1.0.0 · ugx.ai</div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Data sources bar */}
        <div style={{ borderBottom:'1px solid var(--border)' }}>
          <button style={tbt} onClick={() => setShowSources(v=>!v)}>
            <span>{showSources?'▾':'▸'}</span>
            data sources
            <span style={{ fontSize:10, padding:'1px 7px', borderRadius:10, background:'var(--gbg)', color:'var(--gt)', textTransform:'none', letterSpacing:0 }}>active</span>
            <span style={{ marginLeft:'auto', fontSize:10, color:'var(--text3)', letterSpacing:0, textTransform:'none' }}>tested just now</span>
            <button onClick={e=>{e.stopPropagation()}} style={{ ...sbtn, marginLeft:6, fontSize:10, padding:'2px 8px' }}>↺ test all</button>
          </button>
        </div>

        {/* System prompt bar */}
        <div style={{ borderBottom:'1px solid var(--border)' }}>
          <button style={tbt} onClick={() => setShowSystem(v=>!v)}>
            <span>{showSystem?'▾':'▸'}</span>
            system prompt
            {systemPrompt && <span style={{ textTransform:'none', color:'var(--text2)', letterSpacing:0 }}> · active</span>}
          </button>
          {showSystem && (
            <div style={{ padding:'0 14px 10px' }}>
              <textarea value={systemPrompt} onChange={e=>setSystemPrompt(e.target.value)} rows={3} placeholder="You are a helpful assistant..."
                style={{ width:'100%', resize:'none', background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius:6, padding:'8px 10px', fontSize:11, color:'var(--text)', outline:'none' }}/>
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 28px' }}>
          {active.messages.length === 0 ? (
            <div style={{ paddingTop:50 }}>
              <div style={{ fontSize:17, fontWeight:500, marginBottom:6 }}>What can I help with?</div>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:24 }}>Databases · APIs · Web search · File uploads</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
                {CHIPS.map(c => (
                  <button key={c} onClick={() => send(c)}
                    style={{ padding:'6px 13px', border:'1px solid var(--border2)', borderRadius:20, background:'var(--bg3)', fontSize:11, color:'var(--text2)', cursor:'pointer' }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            active.messages.map((msg, i) => (
              <div key={i} style={{ marginBottom:22 }}>
                <div style={{ fontSize:9, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.12em', marginBottom:5 }}>
                  {msg.role==='user'?'you':'claude'}
                </div>
                {msg.tools?.map((tc, j) => (
                  <div key={j} style={{ background:'var(--bg3)', borderLeft:'2px solid var(--border2)', borderRadius:'0 5px 5px 0', padding:'8px 12px', marginBottom:6, fontSize:11 }}>
                    <div style={{ color:'var(--text2)', marginBottom:2 }}>⚙ {tc.name}</div>
                    <div style={{ color:'var(--text3)', fontSize:10 }}>{JSON.stringify(tc.input)}</div>
                    {tc.result !== undefined && (
                      <div style={{ color:'var(--gt)', marginTop:3, fontSize:10 }}>
                        ✓ {JSON.stringify(tc.result).slice(0,140)}{JSON.stringify(tc.result).length>140?'…':''}
                      </div>
                    )}
                  </div>
                ))}
                <div style={{ fontSize:13, lineHeight:1.75, whiteSpace:'pre-wrap', color:msg.role==='user'?'var(--text2)':'var(--text)' }}>
                  {msg.content}
                  {msg.role==='assistant' && isLast(i) && (
                    <span style={{ display:'inline-block', width:7, height:13, background:'var(--text)', marginLeft:2, verticalAlign:'middle', animation:'blink 1s step-end infinite' }}/>
                  )}
                </div>
                {msg.role==='assistant' && i===active.messages.length-1 && !streaming && msg.content && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:10 }}>
                    {['Go deeper','Simplify','Give examples','What next?'].map(label => (
                      <button key={label} onClick={() => send(label)}
                        style={{ padding:'4px 11px', border:'1px solid var(--border2)', borderRadius:14, background:'none', fontSize:10, color:'var(--text3)', cursor:'pointer' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef}/>
        </div>

        {/* Input */}
        <div style={{ borderTop:'1px solid var(--border)', padding:'12px 20px 16px' }}>
          <div style={{ display:'flex', gap:7, alignItems:'flex-end' }}>
            <button style={{ ...sbtn, flexShrink:0, padding:'8px 11px', fontSize:15, lineHeight:1 }}>⊕</button>
            <textarea ref={taRef} value={input}
              onChange={e=>{ setInput(e.target.value); e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,120)+'px' }}
              onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(input)} }}
              placeholder="Message... (Enter to send)" rows={1}
              style={{ flex:1, resize:'none', background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius:8, padding:'9px 13px', fontSize:12, color:'var(--text)', outline:'none', lineHeight:1.6 }}/>
            <button onClick={() => send(input)} disabled={streaming||!input.trim()}
              style={{ flexShrink:0, padding:'9px 18px', borderRadius:8, border:'none', background:streaming||!input.trim()?'var(--bg3)':'var(--text)', color:streaming||!input.trim()?'var(--text3)':'var(--bg2)', fontSize:12, cursor:streaming||!input.trim()?'not-allowed':'pointer', fontWeight:500 }}>
              {streaming?'…':'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
