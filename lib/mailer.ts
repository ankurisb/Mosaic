import { getDb } from './db'
import { log } from './logger'
import { decrypt } from './encrypt'
export const runtime = 'nodejs'

async function getSmtpConfig() {
  try {
    const sql = getDb()
    const rows = await sql`SELECT * FROM smtp_config WHERE id='default' AND enabled=1`
    return rows[0] || null
  } catch { return null }
}

export async function sendWelcomeEmail(
  email: string,
  name: string,
  tempPassword: string,
  appUrl: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const cfg = await getSmtpConfig()
    if (!cfg) return { ok: false, error: 'SMTP not configured' }

    const nodemailer = await import('nodemailer').catch(() => null)
    if (!nodemailer) return { ok: false, error: 'nodemailer not installed' }

    const pass = cfg.password_enc ? decrypt(cfg.password_enc as string) : ''
    const transporter = nodemailer.createTransport({
      host: cfg.host as string,
      port: Number(cfg.port || 587),
      secure: Number(cfg.port) === 465,
      auth: cfg.username ? { user: cfg.username as string, pass } : undefined,
    })

    const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;max-width:600px;margin:0 auto;">
      <div style="background:#000;padding:20px 32px;border-radius:8px 8px 0 0;">
        <span style="color:#fff;font-size:20px;font-weight:600;">Mosaic AI</span>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:32px;border-radius:0 0 8px 8px;">
        <p style="margin:0 0 16px;">Hi ${name},</p>
        <p style="margin:0 0 16px;">Welcome to Mosaic AI. Your account has been created. Sign in at the link below using your email and the temporary password provided.</p>
        <p style="margin:0 0 8px;"><strong>Sign-in URL:</strong> <a href="${appUrl}" style="color:#0070f3;">${appUrl}</a></p>
        <p style="margin:0 0 8px;"><strong>Email:</strong> ${email}</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;margin:16px 0;font-family:monospace;font-size:14px;">
          <strong>Temporary password:</strong> ${tempPassword}
        </div>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">You'll be prompted to change your password on first login.</p>
        <a href="${appUrl}" style="display:inline-block;background:#000;color:#fff;padding:10px 24px;border-radius:999px;text-decoration:none;font-size:14px;font-weight:500;">Sign in to Mosaic</a>
        <hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb;">
        <p style="font-size:11px;color:#9ca3af;margin:0;">Sent by Mosaic AI · ${appUrl}</p>
      </div>
    </div>`

    await transporter.sendMail({
      from: `"${cfg.from_name}" <${cfg.from_address}>`,
      to: email,
      subject: 'Welcome to Mosaic AI — your account is ready',
      text: `Welcome to Mosaic AI.\n\nSign in at: ${appUrl}\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nYou'll be prompted to change your password on first login.`,
      html,
    })

    return { ok: true }
  } catch (e) {
    log.error({ service: 'mailer', err: e }, 'mailer error:')
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
