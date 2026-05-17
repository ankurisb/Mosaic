import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

/**
 * Renders an HTML string to a PDF buffer using Puppeteer + Chromium.
 * Runs entirely server-side, no internet dependency.
 */
async function getChromiumExecutable(): Promise<{ executablePath: string; args: string[] }> {
  const platform = process.platform

  // macOS — use installed Chrome or Chromium
  if (platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ]
    const { existsSync } = await import('fs')
    for (const p of candidates) {
      if (existsSync(p)) return { executablePath: p, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    }
    throw new Error('No Chrome/Chromium found on macOS. Install Google Chrome or Chromium.')
  }

  // Linux/Docker — use @sparticuz/chromium (Lambda-compatible)
  const chromium = await import('@sparticuz/chromium')
  return {
    executablePath: await chromium.default.executablePath(),
    args: chromium.default.args,
  }
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const puppeteer = await import('puppeteer-core')
  const { executablePath, args } = await getChromiumExecutable()

  const browser = await puppeteer.default.launch({
    executablePath,
    args,
    headless: true,
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

/**
 * Builds the base HTML shell with Mosaic branding and common styles.
 */
export function htmlShell(title: string, body: string, subtitle?: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, Arial, sans-serif; font-size: 12px; color: #1a1a2e; line-height: 1.5; }
  .cover { background: #1e3a5f; color: white; padding: 48px 40px; margin-bottom: 32px; border-radius: 0 0 8px 8px; }
  .cover h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
  .cover .subtitle { font-size: 13px; opacity: 0.8; }
  .cover .meta { font-size: 11px; opacity: 0.6; margin-top: 16px; }
  .section { margin-bottom: 28px; page-break-inside: avoid; }
  .section-title { font-size: 14px; font-weight: 700; color: #1e3a5f; border-bottom: 2px solid #1e3a5f; padding-bottom: 6px; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.05em; }
  .insight { background: #eff6ff; border-left: 3px solid #2563eb; padding: 10px 14px; border-radius: 0 6px 6px 0; font-size: 12px; color: #1e3a5f; margin-bottom: 14px; font-style: italic; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 14px; }
  th { background: #1e3a5f; color: white; padding: 7px 10px; text-align: left; font-weight: 600; }
  td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #f9fafb; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px; }
  .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; }
  .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 4px; }
  .kpi-value { font-size: 20px; font-weight: 700; color: #1e3a5f; }
  .kpi-sub { font-size: 10px; color: #94a3b8; margin-top: 2px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; }
  .badge-red { background: #fef2f2; color: #dc2626; }
  .badge-green { background: #f0fdf4; color: #16a34a; }
  .badge-yellow { background: #fffbeb; color: #d97706; }
  .badge-blue { background: #eff6ff; color: #2563eb; }
  .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #94a3b8; text-align: center; }
  .page-break { page-break-after: always; }
  .why-step { display: flex; gap: 12px; margin-bottom: 10px; align-items: flex-start; }
  .why-num { width: 24px; height: 24px; border-radius: 50%; background: #1e3a5f; color: white; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .why-text { flex: 1; }
  .why-q { font-size: 10px; color: #64748b; margin-bottom: 2px; }
  .why-a { font-size: 12px; color: #1a1a2e; font-weight: 500; }
  .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .bar-label { width: 180px; font-size: 11px; color: #374151; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar-track { flex: 1; background: #f1f5f9; border-radius: 3px; height: 16px; position: relative; }
  .bar-fill { height: 100%; border-radius: 3px; background: #2563eb; }
  .bar-fill.vital { background: #dc2626; }
  .bar-val { width: 50px; font-size: 11px; color: #6b7280; text-align: right; }
</style>
</head>
<body>
<div class="cover">
  <div style="font-size:11px;opacity:0.6;margin-bottom:12px;letter-spacing:0.1em;text-transform:uppercase">Mosaic · AI-assisted Analysis</div>
  <h1>${title}</h1>
  ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
  <div class="meta">Generated ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })} · ${new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}</div>
</div>
${body}
<div class="footer">Generated by Mosaic · AI-assisted analysis · Confidential</div>
</body>
</html>`
}
