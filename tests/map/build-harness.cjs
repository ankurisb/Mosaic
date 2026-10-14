// Builds a self-contained HTML page that mirrors components/MapArtifact.tsx
// (circle markers, escaped popups, fit/center/single view, tile-error -> offline
// note, Leaflet-failure -> location-list fallback). Leaflet CSS+JS are inlined
// so the page works with no network and is deterministic to test. The SAME file
// is both the user-facing example (default UGX data, OSM tiles) and the base the
// Playwright suite drives via window.__MAP_DATA__ / window.__MAP_OPTS__.
const fs = require('fs'), path = require('path')
const base = path.join(__dirname, '..', '..', 'node_modules', 'leaflet', 'dist')
const CSS = fs.readFileSync(path.join(base, 'leaflet.css'), 'utf8')
const JS = fs.readFileSync(path.join(base, 'leaflet.js'), 'utf8')

const DEMO = {
  title: 'UGX device sites — Telangana',
  points: [
    { lat: 17.4851, lng: 78.3871, label: 'GM01000050P', detail: 'Inverter · 30/30 days · mean 186.0 W/m²', value: '186.0' },
    { lat: 17.4321, lng: 78.4075, label: 'GM01000038P', detail: 'Inverter · 28/30 days · mean 179.2 W/m²', value: '179.2' },
    { lat: 17.3850, lng: 78.4867, label: 'GM01000055P', detail: 'Inverter · 30/30 days · mean 181.5 W/m²', value: '181.5' },
    { lat: 17.2403, lng: 78.4294, label: 'GM01000041P', detail: 'Inverter · 17/30 days · mean 150.3 W/m²', value: '150.3' },
    { lat: 17.9784, lng: 79.5941, label: 'Warangal site', detail: '2 devices · commissioning', value: '—' },
  ],
}

const APP = `
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];});}
function popupHtml(p){var parts=[];if(p.label)parts.push('<strong>'+esc(p.label)+'</strong>');if(p.detail)parts.push(esc(p.detail));if(p.value!=null)parts.push('<span class="pv">'+esc(String(p.value))+'</span>');return parts.join('<br>');}
function renderList(container, points){
  var wrap=document.createElement('div'); wrap.className='fallback'; wrap.id='fallback';
  var note=document.createElement('div'); note.className='note'; note.textContent='Map view unavailable — showing locations as a list.'; wrap.appendChild(note);
  points.forEach(function(p,i){var row=document.createElement('div');row.className='row';row.innerHTML='<div class="nm">'+esc(p.label||('Point '+(i+1)))+'</div>'+(p.detail?'<div class="dt">'+esc(p.detail)+'</div>':'')+'<div class="co">'+Number(p.lat).toFixed(5)+', '+Number(p.lng).toFixed(5)+(p.value!=null?' · '+esc(String(p.value)):'')+'</div>';wrap.appendChild(row);});
  container.appendChild(wrap);
}
function showOffline(container){ if(document.getElementById('offline'))return; var b=document.createElement('div');b.id='offline';b.className='offline';b.textContent='Offline — basemap unavailable; markers shown.';container.appendChild(b);}
function tileUrlFor(mode){
  if(mode==='bad')return 'https://127.0.0.1:1/{z}/{x}/{y}.png';
  if(mode==='data')return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
}
function renderMap(container, data, opts){
  opts=opts||{}; var points=(data.points||[]);
  window.__RENDER_STATE__={mode:'',markerCount:0,offline:false};
  window.__POPUP_HTML__=points.map(popupHtml);
  if(opts.forceNoLeaflet || typeof L==='undefined'){ renderList(container, points); window.__RENDER_STATE__={mode:'list',markerCount:0,offline:false}; return; }
  try{
    var el=document.createElement('div'); el.className='map'; el.id='map'; container.appendChild(el);
    var map=L.map(el,{zoomControl:true,attributionControl:true});
    var tiles=L.tileLayer(tileUrlFor(opts.tileMode||'osm'),{maxZoom:19,attribution:'© OpenStreetMap'});
    var errs=0;
    tiles.on('tileerror',function(){ if(++errs>=3){ showOffline(container); window.__RENDER_STATE__.offline=true; } });
    tiles.addTo(map);
    var latlngs=[], markerCount=0;
    points.forEach(function(p){ try{ var lat=Number(p.lat),lng=Number(p.lng); if(!isFinite(lat)||!isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return; latlngs.push([lat,lng]);
      var m=L.circleMarker([lat,lng],{radius:7,color:'#1d4ed8',weight:2,fillColor:'#3b82f6',fillOpacity:.7});
      var h=popupHtml(p); if(h)m.bindPopup(h); m.addTo(map); markerCount++; }catch(e){} });
    if(data.center)map.setView([data.center.lat,data.center.lng],data.zoom||10);
    else if(latlngs.length===1)map.setView(latlngs[0],data.zoom||12);
    else if(latlngs.length)map.fitBounds(latlngs,{padding:[32,32]});
    setTimeout(function(){try{map.invalidateSize();}catch(e){}},60);
    window.__MAP__=map; window.__RENDER_STATE__.mode='map'; window.__RENDER_STATE__.markerCount=markerCount;
  }catch(e){ container.innerHTML=''; renderList(container, points); window.__RENDER_STATE__={mode:'list',markerCount:0,offline:false,error:String(e)}; }
}
document.addEventListener('DOMContentLoaded',function(){
  var data=window.__MAP_DATA__||__DEMO__;
  var opts=window.__MAP_OPTS__||{tileMode:'osm'};
  var title=document.getElementById('title'); title.textContent=data.title||'Map';
  document.getElementById('count').textContent=(data.points||[]).length+' location'+((data.points||[]).length===1?'':'s');
  renderMap(document.getElementById('panelBody'), data, opts);
  window.__READY__=true;
});
`

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mosaic — Map artifact</title>
<style>${CSS}</style>
<style>
  :root{--surface:#fff;--bg:#f7f7f8;--bg3:#f0f0f2;--text:#1a1a1a;--text2:#444;--text3:#888;--border:#e4e4e7;--accent-bg:#2563eb;}
  @media (prefers-color-scheme: dark){:root{--surface:#1a1a1c;--bg:#111;--bg3:#232326;--text:#eee;--text2:#bbb;--text3:#888;--border:#333;}}
  *{box-sizing:border-box} html,body{margin:0;height:100%;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text)}
  .panel{display:flex;flex-direction:column;height:100vh;max-width:560px;margin:0 auto;background:var(--surface);border-left:1px solid var(--border);border-right:1px solid var(--border)}
  .head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border);flex-shrink:0}
  .head .t{font-size:13px;font-weight:600}.head .c{font-size:11px;color:var(--text3)}
  #panelBody{flex:1;min-height:0;position:relative}
  .map{height:100%;width:100%;background:var(--bg3)}
  .leaflet-popup-content .pv,.pv{color:#1d4ed8;font-weight:600}
  .offline{position:absolute;bottom:8px;left:8px;z-index:500;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--text3)}
  .fallback{height:100%;overflow:auto;padding:14px}.fallback .note{font-size:12px;color:var(--text3);margin-bottom:10px}
  .fallback .row{padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
  .fallback .nm{font-weight:600}.fallback .dt{color:var(--text2)}.fallback .co{color:var(--text3);font-family:ui-monospace,monospace;font-size:11px}
</style>
<script>${JS}</script>
</head>
<body>
  <div class="panel">
    <div class="head"><div style="flex:1;min-width:0"><div class="t" id="title">Map</div><div class="c" id="count"></div></div></div>
    <div id="panelBody"></div>
  </div>
<script>var __DEMO__=${JSON.stringify(DEMO)};\n${APP}</script>
</body></html>`

const out = path.join(__dirname, 'map-harness.html')
fs.writeFileSync(out, HTML)
console.log('wrote', out, (HTML.length / 1024).toFixed(0) + 'KB')
