// Headless-browser tests for the Phase 2 map rendering + graceful degradation,
// driving tests/map/map-harness.html (which mirrors components/MapArtifact.tsx).
// Deterministic + network-free: "online" tiles use a data: URI, "offline" uses a
// dead host so the tileerror -> offline path fires without real network.
//
//   node tests/map/build-harness.cjs && node tests/map/map.spec.cjs
const { chromium } = require('playwright')
const path = require('path')
const URL = 'file://' + path.join(__dirname, 'map-harness.html')

let pass = 0, fail = 0
const ok = (n, c, d = '') => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? '  ' + d : ''}`); c ? pass++ : fail++ }

async function load(browser, data, opts) {
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } })
  await page.addInitScript(([d, o]) => { if (d) window.__MAP_DATA__ = d; if (o) window.__MAP_OPTS__ = o }, [data, opts])
  await page.goto(URL)
  await page.waitForFunction(() => window.__READY__ === true, { timeout: 8000 })
  return page
}

const PT = (lat, lng, label, extra = {}) => ({ lat, lng, label, ...extra })

async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    // 1. Happy path — 5 points render as 5 SVG circle markers
    {
      const data = { title: 'Sites', points: [PT(17.48, 78.38, 'A'), PT(17.43, 78.40, 'B'), PT(17.38, 78.48, 'C'), PT(17.24, 78.42, 'D'), PT(17.97, 79.59, 'E')] }
      const page = await load(browser, data, { tileMode: 'data' })
      await page.waitForTimeout(400)
      const st = await page.evaluate(() => window.__RENDER_STATE__)
      const paths = await page.locator('#map path.leaflet-interactive').count()
      ok('5 points → map mode, 5 markers, not offline', st.mode === 'map' && st.markerCount === 5 && st.offline === false && paths === 5, `markers=${st.markerCount} paths=${paths} offline=${st.offline}`)
      await page.close()
    }

    // 2. Leaflet unavailable → list fallback
    {
      const data = { title: 'Sites', points: [PT(1, 2, 'X'), PT(3, 4, 'Y')] }
      const page = await load(browser, data, { forceNoLeaflet: true })
      const st = await page.evaluate(() => window.__RENDER_STATE__)
      const rows = await page.locator('#fallback .row').count()
      const hasMap = await page.locator('#map').count()
      ok('Leaflet unavailable → list fallback (no map)', st.mode === 'list' && rows === 2 && hasMap === 0, `rows=${rows}`)
      await page.close()
    }

    // 3. Tiles fail → offline note, markers still shown
    {
      const data = { title: 'Sites', points: [PT(17.4, 78.4, 'A'), PT(17.5, 78.5, 'B')] }
      const page = await load(browser, data, { tileMode: 'bad' })
      await page.waitForFunction(() => window.__RENDER_STATE__ && window.__RENDER_STATE__.offline === true, { timeout: 8000 }).catch(() => {})
      const st = await page.evaluate(() => window.__RENDER_STATE__)
      const offVisible = await page.locator('#offline').isVisible().catch(() => false)
      ok('tiles fail → offline note + markers remain', st.mode === 'map' && st.offline === true && offVisible && st.markerCount === 2, `offline=${st.offline} vis=${offVisible}`)
      await page.close()
    }

    // 4. Single point still initialises a map
    {
      const page = await load(browser, { title: 'One', points: [PT(28.61, 77.21, 'Delhi')] }, { tileMode: 'data' })
      await page.waitForTimeout(300)
      const st = await page.evaluate(() => window.__RENDER_STATE__)
      ok('single point → map mode, 1 marker', st.mode === 'map' && st.markerCount === 1, `markers=${st.markerCount}`)
      await page.close()
    }

    // 5. Invalid / out-of-range coords dropped; map stays (no collapse to list)
    {
      const data = { points: [PT(17, 78, 'ok1'), PT(91, 0, 'bad-lat'), PT(0, 200, 'bad-lng'), { lat: 'abc', lng: 5, label: 'nonnum' }, PT(-10, -20, 'ok2')] }
      const page = await load(browser, data, { tileMode: 'data' })
      await page.waitForTimeout(300)
      const st = await page.evaluate(() => window.__RENDER_STATE__)
      const paths = await page.locator('#map path.leaflet-interactive').count()
      ok('invalid coords dropped (2 of 5), map not collapsed to list', st.mode === 'map' && st.markerCount === 2 && paths === 2, `mode=${st.mode} markers=${st.markerCount} paths=${paths}`)
      await page.close()
    }

    // 6. XSS in label/detail is escaped — no element injected
    {
      const data = { points: [PT(17, 78, '<img src=x onerror="window.__PWNED__=1">', { detail: '<script>window.__PWNED__=1</script>', value: '<b>v</b>' })] }
      const page = await load(browser, data, { tileMode: 'data' })
      await page.waitForTimeout(300)
      const res = await page.evaluate(() => {
        const html = window.__POPUP_HTML__[0]
        const d = document.createElement('div'); d.innerHTML = html  // what Leaflet does on open
        return { pwned: !!window.__PWNED__, escaped: html.includes('&lt;img') && html.includes('&lt;script'), injectedEls: d.querySelectorAll('img,script,b').length }
      })
      ok('popup content escaped — no script/img/element injected', res.pwned === false && res.escaped && res.injectedEls === 0, `pwned=${res.pwned} els=${res.injectedEls}`)
      await page.close()
    }

    // 7. Large set (500 points) renders without error
    {
      const points = Array.from({ length: 500 }, (_, i) => PT(10 + (i % 70) * 0.1, 70 + (i % 100) * 0.1, 'P' + i))
      const page = await load(browser, { title: 'Many', points }, { tileMode: 'data' })
      await page.waitForTimeout(600)
      const st = await page.evaluate(() => window.__RENDER_STATE__)
      const paths = await page.locator('#map path.leaflet-interactive').count()
      ok('500 points render in map mode', st.mode === 'map' && st.markerCount === 500 && paths === 500, `markers=${st.markerCount} paths=${paths}`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log(`\n${pass}/${pass + fail} passed — ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(2) })
