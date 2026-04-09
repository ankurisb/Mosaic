import { SH, SS, SLBL, CARD, Badge } from './ui'

const DEPS = [
  {name:'@anthropic-ai/sdk',ver:'0.39.0',ok:true},
  {name:'@neondatabase/serverless',ver:'0.10.4',ok:true},
  {name:'bcryptjs',ver:'2.4.3',ok:true},
  {name:'jose',ver:'5.9.6',ok:true},
  {name:'next',ver:'15.3.9',ok:true},
  {name:'pg',ver:'8.13.1',ok:false},
  {name:'react',ver:'19.1.0',ok:true},
  {name:'typescript',ver:'5.7.3',ok:true},
]

export default function TabAbout() {
  return (
    <div>
      <div style={SH}>About</div>
      <div style={SS}>Version information and changelog.</div>

      <div style={{ background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius:10, padding:24, marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:6 }}>
          <span style={{ fontSize:22, fontWeight:500 }}>claude app</span>
          <span style={{ fontSize:12, color:'var(--text2)', padding:'2px 8px', borderRadius:5, background:'var(--bg4)', border:'1px solid var(--border2)' }}>v1.0.0</span>
          <Badge label="stable" color="green"/>
        </div>
        <div style={{ fontSize:11, color:'var(--text3)', marginBottom:18 }}>Build 20260408 · Released 8 April 2026 · ugx.ai</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
          {[
            ['Platform','Vercel (Node.js)','Serverless'],
            ['AI model','claude-sonnet-4-5','Streaming enabled'],
            ['Database','PostgreSQL · Neon','Auto-scaling'],
            ['Auth','JWT + bcrypt','7-day sessions'],
            ['Web search','Tavily API','1,000 free/month'],
            ['DB querying','node-postgres','PG, MySQL, MSSQL'],
          ].map(([l,v,s])=>(
            <div key={l} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:7, padding:'10px 13px' }}>
              <div style={{ fontSize:9, color:'var(--text3)', textTransform:'uppercase' as const, letterSpacing:'.08em', marginBottom:3 }}>{l}</div>
              <div style={{ fontSize:12, color:'var(--text)', fontWeight:500, marginBottom:2 }}>{v}</div>
              <div style={{ fontSize:10, color:'var(--text3)' }}>{s}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={SLBL}>Dependencies</div>
      <div style={CARD}>
        <div style={{ padding:'0 16px' }}>
          {DEPS.map((d,i)=>(
            <div key={d.name} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 0', borderBottom:i<DEPS.length-1?'1px solid var(--border)':'none' }}>
              <span style={{ fontSize:12, color:'var(--text2)' }}>{d.name}</span>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:11, color:'var(--text3)' }}>{d.ver}</span>
                <span style={{ fontSize:11, fontWeight:500, color:d.ok?'var(--gt)':'var(--at)' }}>{d.ok?'✓ up to date':'↑ update available'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={SLBL}>Changelog</div>
      <div style={CARD}>
        <div style={{ padding:'14px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <span style={{ fontSize:12, fontWeight:500 }}>v1.0.0</span>
            <span style={{ fontSize:10, color:'var(--text3)' }}>8 April 2026</span>
            <Badge label="initial release" color="green"/>
          </div>
          {['Claude chat with streaming responses and tool use','Web search via Tavily API','Database connections — query from chat','API service workspaces — call HubSpot, Stripe etc','User management with admin/user roles','Usage analytics with per-user cost tracking','Service monitoring with live health checks'].map((item,i)=>(
            <div key={i} style={{ fontSize:11, color:'var(--text2)', lineHeight:1.9 }}>· {item}</div>
          ))}
        </div>
      </div>

      <div style={{ fontSize:10, color:'var(--text3)', textAlign:'center' as const, paddingTop:8 }}>
        claude app v1.0.0 · build 20260408 · ugx.ai · powered by Anthropic Claude
      </div>
    </div>
  )
}
