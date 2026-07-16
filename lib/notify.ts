// -- lib/notify.ts ---------------------------------------------
// Dispatch notifications to Slack, Teams, Email, and Webhook channels.
// Called by the scheduler route after a rule fires.

import { decrypt } from './encrypt'
import { getKey }  from './keys'

export interface Channel {
  id:     string
  name:   string
  type:   string
  config: Record<string, unknown>
}

export interface NotifyResult {
  ok:         boolean
  message?:   string
  error?:     string
  latency_ms: number
}

// -- Main dispatcher -------------------------------------------
export async function sendNotification(
  channel: Channel,
  message: string
): Promise<NotifyResult> {
  const start = Date.now()
  try {
    switch (channel.type) {
      case 'slack':             return await sendSlack(channel.config,          message, start)
      case 'teams':             return await sendTeams(channel.config,          message, start)
      case 'webhook':           return await sendWebhook(channel.config,        message, start)
      case 'email':             return await sendEmail(channel.config,          message, start)
      case 'twilio_sms':        return await sendTwilioSMS(channel.config,      message, start)
      case 'twilio_whatsapp':   return await sendTwilioWhatsApp(channel.config, message, start)
      default:
        return { ok: false, error: `Unknown channel type: ${channel.type}`, latency_ms: Date.now() - start }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error', latency_ms: Date.now() - start }
  }
}

// -- Slack -----------------------------------------------------
async function sendSlack(
  config: Record<string, unknown>,
  message: string,
  start: number
): Promise<NotifyResult> {
  const webhookUrlEnc = config.webhook_url as string
  if (!webhookUrlEnc) return { ok: false, error: 'No webhook_url configured', latency_ms: Date.now() - start }
  // webhook_url is stored encrypted by buildConfig in channels/route.ts; decrypt before use.
  const webhookUrl = decrypt(webhookUrlEnc)

  const res = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: message }),
    signal:  AbortSignal.timeout(8000),
  })
  if (!res.ok) return { ok: false, error: `Slack returned ${res.status}`, latency_ms: Date.now() - start }
  return { ok: true, message, latency_ms: Date.now() - start }
}

// -- Microsoft Teams -------------------------------------------
async function sendTeams(
  config: Record<string, unknown>,
  message: string,
  start: number
): Promise<NotifyResult> {
  const webhookUrlEnc = config.webhook_url as string
  if (!webhookUrlEnc) return { ok: false, error: 'No webhook_url configured', latency_ms: Date.now() - start }
  // webhook_url is stored encrypted by buildConfig in channels/route.ts; decrypt before use.
  const webhookUrl = decrypt(webhookUrlEnc)

  // Teams uses the Adaptive Card / MessageCard format
  const body = {
    '@type':    'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary:    message.slice(0, 80),
    themeColor: '0078D4',
    sections:   [{ text: message }],
  }

  const res = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(8000),
  })
  if (!res.ok) return { ok: false, error: `Teams returned ${res.status}`, latency_ms: Date.now() - start }
  return { ok: true, message, latency_ms: Date.now() - start }
}

// -- Outbound webhook ------------------------------------------
async function sendWebhook(
  config: Record<string, unknown>,
  message: string,
  start: number
): Promise<NotifyResult> {
  const url = config.url as string
  if (!url) return { ok: false, error: 'No url configured', latency_ms: Date.now() - start }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Optional auth header e.g. {"Authorization": "Bearer <token>"}
  const extraHeaders = config.headers as Record<string, string> | undefined
  if (extraHeaders) Object.assign(headers, extraHeaders)

  const payload = {
    message,
    timestamp: new Date().toISOString(),
    source:    'mosaic',
  }

  const res = await fetch(url, {
    method:  'POST',
    headers,
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(8000),
  })
  if (!res.ok) return { ok: false, error: `Webhook returned ${res.status}`, latency_ms: Date.now() - start }
  return { ok: true, message, latency_ms: Date.now() - start }
}

// -- Email (SMTP via nodemailer) -------------------------------
async function sendEmail(
  config: Record<string, unknown>,
  message: string,
  start: number
): Promise<NotifyResult> {
  const host = config.smtp_host as string
  const port = Number(config.smtp_port || 587)
  const user = config.smtp_user as string
  const passEnc = config.smtp_pass_enc as string
  const from = config.from_address as string
  // recipients is an array (e.g. ["ops@acme.com","mgr@acme.com"]); join for nodemailer
  const recipientsRaw = config.recipients
  const to = Array.isArray(recipientsRaw)
    ? recipientsRaw.join(", ")
    : (recipientsRaw as string || "")

  if (!host || !from || !to) {
    return { ok: false, error: 'Missing smtp_host, from_address or recipients', latency_ms: Date.now() - start }
  }

  const pass = passEnc ? decrypt(passEnc) : ''

  // Dynamic import -- nodemailer not always bundled
  const nodemailer = await import('nodemailer').catch(() => null)
  if (!nodemailer) {
    return { ok: false, error: 'nodemailer not installed -- run: npm install nodemailer', latency_ms: Date.now() - start }
  }

  const transporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  })

  // Convert plain text message to basic HTML
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;max-width:600px;">
    ${message.replace(/\n/g, '<br>')}
    <hr style="margin:20px 0;border:none;border-top:1px solid #e0e0e0;">
    <p style="font-size:11px;color:#8a8a8a;">Sent by Mosaic . <a href="#">View dashboard</a></p>
  </div>`

  await transporter.sendMail({
    from,
    to,
    subject: message.split('\n')[0].slice(0, 100),
    text:    message,
    html,
  })

  return { ok: true, message, latency_ms: Date.now() - start }
}


// -- Email with PDF attachment --------------------------------
export async function sendReportEmail(opts: {
  recipients: string[]
  subject:    string
  body:       string
  pdfBuffer:  Buffer
  pdfName:    string
}): Promise<NotifyResult> {
  const start = Date.now()
  const sql   = (await import('./db')).getDb()

  // Load SMTP config from DB
  const [cfg] = await sql`SELECT * FROM smtp_config WHERE id = 'default' AND enabled = true`
  if (!cfg) {
    // Fall back to env vars
    const host = process.env.SMTP_HOST
    const port = Number(process.env.SMTP_PORT || 587)
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASS
    const from = process.env.SMTP_USER || 'mosaic@noreply.com'
    if (!host) return { ok: false, error: 'No SMTP config found — add one in Settings → Notifications', latency_ms: Date.now() - start }

    const nodemailer = await import('nodemailer').catch(() => null)
    if (!nodemailer) return { ok: false, error: 'nodemailer not installed', latency_ms: Date.now() - start }

    const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined })
    await t.sendMail({
      from, to: opts.recipients.join(', '), subject: opts.subject,
      text: opts.body, html: opts.body.replace(/\n/g, '<br>'),
      attachments: [{ filename: opts.pdfName, content: opts.pdfBuffer, contentType: 'application/pdf' }],
    })
    return { ok: true, latency_ms: Date.now() - start }
  }

  const c = cfg as Record<string, unknown>
  const host     = c.host         as string
  const port     = Number(c.port  || 587)
  const user     = c.username     as string | undefined
  const passEnc  = c.password_enc as string | undefined
  const pass     = passEnc ? decrypt(passEnc) : undefined
  const from     = c.from_address as string

  const nodemailer = await import('nodemailer').catch(() => null)
  if (!nodemailer) return { ok: false, error: 'nodemailer not installed', latency_ms: Date.now() - start }

  const transporter = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: user ? { user, pass } : undefined,
  })

  await transporter.sendMail({
    from,
    to:      opts.recipients.join(', '),
    subject: opts.subject,
    text:    opts.body,
    html:    `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;max-width:600px">
      ${opts.body.replace(/\n/g, '<br>')}
      <hr style="margin:20px 0;border:none;border-top:1px solid #e0e0e0">
      <p style="font-size:11px;color:#8a8a8a">Sent by Mosaic · Scheduled Report</p>
    </div>`,
    attachments: [{
      filename:    opts.pdfName,
      content:     opts.pdfBuffer,
      contentType: 'application/pdf',
    }],
  })

  return { ok: true, latency_ms: Date.now() - start }
}

// -- Message template renderer ---------------------------------
// Replaces {variable} placeholders in a template string
export function renderTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`))
}

// -- Twilio SMS ------------------------------------------------
export async function sendTwilioSMS(
  config: Record<string, unknown>,
  message: string,
  start: number
): Promise<NotifyResult> {
  const accountSid = (config.account_sid as string) || await getKey('TWILIO_ACCOUNT_SID') || ''
  const authToken  = config.auth_token_enc
    ? decrypt(config.auth_token_enc as string)
    : (config.auth_token as string) || await getKey('TWILIO_AUTH_TOKEN') || ''
  const from       = config.from_number as string
  const to         = config.to_number   as string

  if (!accountSid || !authToken || !from || !to)
    return { ok: false, error: 'Missing account_sid, auth_token, from_number or to_number', latency_ms: Date.now() - start }

  const url  = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
  const body = new URLSearchParams({ From: from, To: to, Body: message })

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>
    return { ok: false, error: `Twilio SMS error ${res.status}: ${err.message || res.statusText}`, latency_ms: Date.now() - start }
  }
  return { ok: true, message, latency_ms: Date.now() - start }
}

// -- Twilio WhatsApp -------------------------------------------
// Requires a Meta-approved message template for business-initiated messages.
// Template params are substituted into the approved template body.
export async function sendTwilioWhatsApp(
  config: Record<string, unknown>,
  message: string,
  start: number
): Promise<NotifyResult> {
  const accountSid    = (config.account_sid as string) || await getKey('TWILIO_ACCOUNT_SID') || ''
  const authToken     = config.auth_token_enc
    ? decrypt(config.auth_token_enc as string)
    : (config.auth_token as string) || await getKey('TWILIO_AUTH_TOKEN') || ''
  const from          = `whatsapp:${config.from_number as string}`
  const to            = `whatsapp:${config.to_number   as string}`
  const templateSid   = config.template_sid as string | undefined
  const contentVars   = config.content_variables as Record<string, string> | undefined

  if (!accountSid || !authToken || !config.from_number || !config.to_number)
    return { ok: false, error: 'Missing account_sid, auth_token, from_number or to_number', latency_ms: Date.now() - start }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`

  // Use approved template if provided, else fall back to freeform (sandbox only)
  const body = new URLSearchParams({ From: from, To: to })
  if (templateSid) {
    body.set('ContentSid', templateSid)
    if (contentVars) body.set('ContentVariables', JSON.stringify(contentVars))
  } else {
    body.set('Body', message) // Freeform -- only works in Twilio sandbox
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>
    return { ok: false, error: `Twilio WhatsApp error ${res.status}: ${err.message || res.statusText}`, latency_ms: Date.now() - start }
  }
  return { ok: true, message, latency_ms: Date.now() - start }
}
