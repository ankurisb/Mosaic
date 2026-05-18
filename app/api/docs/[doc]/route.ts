// app/api/docs/[doc]/route.ts
// Generates live ISO 27001 compliance documents as HTML (print to PDF).
// Auto-populated with real data from the database — always current.
//
// GET /api/docs/retention-policy   — Retention Policy Statement (A.8.15)
// GET /api/docs/risk-assessment     — Information Security Risk Assessment (6.1.2)
// GET /api/docs/training-records    — Staff Awareness Training Records (A.6.3)

import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ doc: string }> }
) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return new Response('Admin only', { status: 403 })

  const { doc } = await params
  const sql = getDb()
  const now    = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  const orgName = process.env.ORG_NAME || 'UGX Systems Pvt Ltd'

  let html = ''

  // ── Retention Policy ───────────────────────────────────────────────────
  if (doc === 'retention-policy') {
    const [s1, s2, s3] = await Promise.all([
      sql`SELECT value FROM audit_settings WHERE key = 'retention_days' LIMIT 1`.catch(() => []),
      sql`SELECT value FROM audit_settings WHERE key = 'last_purge_at' LIMIT 1`.catch(() => []),
      sql`SELECT COUNT(*) as cnt FROM audit_events`.catch(() => [{ cnt: '0' }]),
    ])
    const retDays  = (s1[0] as { value: string } | undefined)?.value || '365'
    const retYears = (Number(retDays) / 365).toFixed(1)
    const lastPurge = (s2[0] as { value: string } | undefined)?.value
    const totalEvents = (s3[0] as { cnt: string })?.cnt || '0'

    html = buildDoc({ title: 'Audit Log Retention Policy', subtitle: 'ISO 27001:2022 — Control A.8.15', dateStr, orgName, sections: [
      { heading: '1. Purpose',
        body: `This document defines the retention policy for the Mosaic platform audit log. It satisfies the requirements of ISO 27001:2022 Control A.8.15 (Logging) and ensures that audit records are retained for a sufficient period to support security investigations, regulatory enquiries, and compliance audits.` },
      { heading: '2. Scope',
        body: `This policy applies to all audit events recorded by the Mosaic platform, including authentication events, data source access, configuration changes, and system operations. It applies to all administrators and users of the Mosaic deployment at ${orgName}.` },
      { heading: '3. Retention Period',
        body: `Audit events SHALL be retained for a minimum of <strong>${retDays} days (${retYears} years)</strong>. This period exceeds the ISO 27001 recommended minimum of one year and satisfies common regulatory requirements including GDPR Article 30, NIS2, and SOC 2 Type II.` },
      { heading: '4. Current Configuration',
        table: [
          ['Setting', 'Value'],
          ['Retention period', `${retDays} days (${retYears} years)`],
          ['Current event count', Number(totalEvents).toLocaleString()],
          ['Last nightly purge', lastPurge ? new Date(lastPurge).toLocaleString() : 'Not yet run'],
          ['Purge schedule', 'Nightly (automated)'],
          ['Storage location', 'audit_events table (SQLite / Postgres)'],
          ['Chain integrity', 'SHA-256 hash chain — tamper-evident'],
        ] },
      { heading: '5. Automated Purge Process',
        body: `The Mosaic platform automatically purges audit events older than the configured retention period each night. Before purging, the system re-anchors the hash chain so chain integrity verification remains valid. Each purge is itself recorded as an <code>AUDIT_PURGE</code> event.` },
      { heading: '6. Tamper Evidence',
        body: `Every audit event is protected by a SHA-256 hash chain. Each event's checksum is <code>SHA-256(prev_checksum + payload)</code>. Any deletion, modification, or insertion breaks the chain. Daily automated verification records the result as <code>CHAIN_VERIFY</code>. Administrators can verify at any time from Settings → Audit Trail.` },
      { heading: '7. Access Controls',
        body: `Access to the audit log is restricted to <strong>admin</strong> role users. Every access (viewing or exporting) is recorded as <code>AUDIT_LOG_VIEW</code> or <code>AUDIT_LOG_EXPORT</code>, providing full chain of custody.` },
      { heading: '8. Review and Approval',
        table: [
          ['Role', 'Name', 'Date', 'Signature'],
          ['Document Owner', '', dateStr, '________________'],
          ['Information Security Manager', '', '', '________________'],
          ['Approved By', '', '', '________________'],
        ] },
      { heading: '9. Document Control',
        table: [
          ['Version', 'Date', 'Change'],
          ['1.0', dateStr, 'Initial version — generated from live configuration'],
        ] },
    ]})

  // ── Risk Assessment ────────────────────────────────────────────────────
  } else if (doc === 'risk-assessment') {
    const [uR, cR, aR, fR] = await Promise.all([
      sql`SELECT COUNT(*) as cnt FROM users WHERE banned = 0`.catch(() => [{ cnt: '0' }]),
      sql`SELECT COUNT(*) as cnt FROM db_connections`.catch(() => [{ cnt: '0' }]),
      sql`SELECT COUNT(*) as cnt FROM api_services`.catch(() => [{ cnt: '0' }]),
      sql`SELECT COUNT(*) as cnt FROM audit_events WHERE action = 'LOGIN_FAILED' AND timestamp > datetime('now', '-30 days')`.catch(() => [{ cnt: '0' }]),
    ])
    const userCount   = (uR[0] as { cnt: string })?.cnt || '0'
    const connCount   = (cR[0] as { cnt: string })?.cnt || '0'
    const apiCount    = (aR[0] as { cnt: string })?.cnt || '0'
    const failedCount = (fR[0] as { cnt: string })?.cnt || '0'

    html = buildDoc({ title: 'Information Security Risk Assessment', subtitle: 'ISO 27001:2022 — Clause 6.1.2', dateStr, orgName, sections: [
      { heading: '1. Purpose and Scope',
        body: `This risk assessment identifies and evaluates information security risks associated with the Mosaic AI intelligence platform at ${orgName}. Prepared per ISO 27001:2022 Clause 6.1.2 to support the organisation's ISMS.` },
      { heading: '2. Asset Inventory',
        table: [
          ['Asset', 'Type', 'Count', 'Classification'],
          ['User accounts', 'Identity', userCount, 'Confidential'],
          ['Database connections', 'Data asset', connCount, 'Confidential'],
          ['API integrations', 'Data asset', apiCount, 'Confidential'],
          ['Audit event log', 'Compliance record', 'All events', 'Restricted'],
          ['Conversation history', 'Operational data', 'All chats', 'Confidential'],
          ['Anthropic API key', 'Credential', '1', 'Restricted'],
          ['Encryption secret key', 'Cryptographic key', '1', 'Restricted'],
        ] },
      { heading: '3. Risk Register',
        table: [
          ['ID', 'Threat', 'Likelihood', 'Impact', 'Rating', 'Control'],
          ['R-01', 'Unauthorised access / weak passwords', 'Medium', 'High', 'HIGH', 'A.8.2, A.5.17'],
          ['R-02', 'API credential theft', 'Low', 'Critical', 'HIGH', 'A.5.17 (AES-256-GCM)'],
          ['R-03', 'Data exfiltration via query results', 'Low', 'High', 'MEDIUM', 'A.8.15 egress_events'],
          ['R-04', 'Audit log tampering', 'Low', 'Critical', 'MEDIUM', 'A.8.15 SHA-256 chain'],
          ['R-05', 'Prompt injection', 'Medium', 'Medium', 'MEDIUM', 'A.8.22 injection_defense'],
          ['R-06', 'Excessive AI usage / cost', 'Medium', 'Low', 'LOW', 'A.8.22 usage_limits'],
          ['R-07', 'Insider threat / admin misuse', 'Low', 'High', 'MEDIUM', 'A.8.15 AUDIT_LOG_VIEW'],
          ['R-08', 'Service unavailability', 'Low', 'Medium', 'LOW', 'A.8.14 architecture'],
          ['R-09', 'Data loss / no automated backup', 'Medium', 'High', 'HIGH', 'A.8.13 — treatment required'],
          ['R-10', 'Stale audit records', 'Low', 'Medium', 'LOW', 'A.8.15 retention policy'],
        ] },
      { heading: '4. Controls Implemented',
        table: [
          ['Control', 'ISO 27001', 'Status'],
          ['Audit logging — SHA-256 hash chain', 'A.8.15', '✓ Implemented'],
          ['Audit log retention (365 days, automated purge)', 'A.8.15', '✓ Implemented'],
          ['Role-based access control (admin / user)', 'A.8.2', '✓ Implemented'],
          ['Privileged access auditing', 'A.8.2', '✓ Implemented'],
          ['Credential encryption (AES-256-GCM)', 'A.5.17', '✓ Implemented'],
          ['Egress / data exfiltration logging', 'A.8.15', '✓ Implemented'],
          ['Content guardrails + injection defence', 'A.8.22', '✓ Implemented'],
          ['Developer API key hashing (SHA-256)', 'A.5.17', '✓ Implemented'],
          ['Daily chain integrity verification', 'A.8.15', '✓ Implemented'],
          ['Automated database backup', 'A.8.13', '⚠ Partial — manual only'],
          ['Multi-factor authentication', 'A.8.5', '✗ Not yet — Phase D roadmap'],
          ['Single sign-on (SSO / LDAP)', 'A.5.16', '✗ Not yet — Phase D roadmap'],
        ] },
      { heading: '5. Login Statistics (Last 30 Days)',
        table: [
          ['Metric', 'Value'],
          ['Failed login attempts', failedCount],
          ['Active users', userCount],
          ['Connected data sources', `${connCount} databases, ${apiCount} APIs`],
        ] },
      { heading: '6. Residual Risks & Treatment',
        body: `<strong>R-01 / R-09 (High):</strong> Add password policy enforcement and MFA (Phase D). Implement pgBackRest automated backup (Phase I).<br><br><strong>R-02 (High):</strong> Establish credential rotation schedule. Add secret scanning to CI/CD pipeline.<br><br><strong>R-05 (Medium):</strong> Current injection detection logs and flags. Consider stricter input validation for high-sensitivity deployments.` },
      { heading: '7. Sign-off',
        table: [
          ['Role', 'Name', 'Date', 'Signature'],
          ['Risk Owner', '', dateStr, '________________'],
          ['Information Security Manager', '', '', '________________'],
          ['Management Representative', '', '', '________________'],
        ] },
    ]})

  // ── Training Records ───────────────────────────────────────────────────
  } else if (doc === 'training-records') {
    const userRows = await sql`
      SELECT email, name, role, created_at FROM users WHERE banned = 0 ORDER BY created_at ASC
    `.catch(() => [])

    const userTableRows = (userRows as Array<Record<string,string>>).map(u => [
      u.name || u.email.split('@')[0], u.email, u.role,
      u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB') : '',
      'Platform Onboarding', '', '',
    ])

    html = buildDoc({ title: 'Staff Awareness Training Records', subtitle: 'ISO 27001:2022 — Control A.6.3', dateStr, orgName, sections: [
      { heading: '1. Purpose',
        body: `This document records information security awareness training for all personnel with access to the Mosaic AI platform. It satisfies ISO 27001:2022 Control A.6.3 and demonstrates that all personnel have received appropriate training on their security obligations.` },
      { heading: '2. Training Programme',
        table: [
          ['Module', 'Coverage', 'Duration', 'Frequency'],
          ['Platform Onboarding', 'Data handling, acceptable use, access control', '30 min', 'On account creation'],
          ['Password & Credential Policy', 'Strong passwords, no sharing, key rotation', '15 min', 'Annual'],
          ['Incident Reporting', 'How to report incidents, escalation path, SLA', '15 min', 'Annual'],
          ['AI Governance & Responsible Use', 'Data classification, prompt hygiene, output review', '20 min', 'Annual'],
          ['Audit & Logging Awareness', 'What is logged, user obligations, data retention', '10 min', 'Annual'],
        ] },
      { heading: '3. Training Register',
        body: 'All personnel below are required to complete the Platform Onboarding module. Annual modules apply from the anniversary of account creation. Trainer and signature columns to be completed on training completion.',
        table: [
          ['Name', 'Email', 'Role', 'Account Created', 'Module', 'Completed', 'Trainer', 'Signed'],
          ...userTableRows,
        ] },
      { heading: '4. Key Policy Points',
        body: `<strong>Acceptable Use:</strong> Only access data necessary for your role. Handle PII in accordance with the data protection policy.<br><br><strong>Credentials:</strong> Passwords must be at least 12 characters and must not be shared. Never embed API keys in code or share via email.<br><br><strong>Incident Reporting:</strong> Report any suspected security incident to the Information Security Manager within 24 hours.<br><br><strong>AI Governance:</strong> Do not input classified, legally privileged, or sensitive personal data into AI prompts without prior approval. All interactions are logged.<br><br><strong>Data Classification:</strong> Treat data accessed through Mosaic as minimum <em>Confidential</em>. Credentials and keys are <em>Restricted</em>.` },
      { heading: '5. Annual Review Log',
        table: [
          ['Year', 'Reviewed By', 'Date', 'Changes'],
          [String(now.getFullYear()), '', dateStr, 'Initial version — auto-populated from Mosaic'],
          [String(now.getFullYear() + 1), '', '', ''],
          [String(now.getFullYear() + 2), '', '', ''],
        ] },
      { heading: '6. Document Control',
        table: [
          ['Version', 'Date', 'Change'],
          ['1.0', dateStr, 'Initial — user list auto-populated from Mosaic platform'],
        ] },
    ]})

  } else {
    return new Response('Document not found', { status: 404 })
  }

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'SAMEORIGIN' },
  })
}

// ── HTML builder ─────────────────────────────────────────────────────────
interface Section { heading: string; body?: string; table?: string[][] }

function buildDoc({ title, subtitle, dateStr, orgName, sections }: {
  title: string; subtitle: string; dateStr: string; orgName: string; sections: Section[]
}): string {
  const sectionsHtml = sections.map(s => {
    let c = ''
    if (s.body) c += `<p>${s.body}</p>`
    if (s.table) {
      const [hdr, ...rows] = s.table
      c += `<table><thead><tr>${hdr.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr>${r.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')
      }</tbody></table>`
    }
    return `<section><h2>${s.heading}</h2>${c}</section>`
  }).join('')

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Segoe UI',sans-serif;font-size:13px;color:#1a1a1a;background:#fff;max-width:960px;margin:0 auto;padding:32px 40px 60px}
.hdr{border-bottom:2px solid #0f0f0f;padding-bottom:18px;margin-bottom:26px;display:flex;justify-content:space-between;align-items:flex-end}
.hdr-l h1{font-size:21px;font-weight:700;letter-spacing:-.3px;margin-bottom:4px}
.hdr-l .sub{font-size:12px;color:#666;font-weight:500}
.badge{display:inline-block;background:#f0f0f0;border:1px solid #ddd;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;color:#555;margin-bottom:6px}
.hdr-r{text-align:right;font-size:11px;color:#666;line-height:1.7}
.hdr-r strong{color:#1a1a1a;font-size:12px}
section{margin-bottom:26px}
h2{font-size:11px;font-weight:700;color:#0f0f0f;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #e5e5e5}
p{line-height:1.65;color:#333;margin-bottom:8px}
code{font-family:'Courier New',monospace;font-size:11px;background:#f5f5f5;padding:1px 4px;border-radius:3px}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
th{background:#f5f5f5;text-align:left;padding:6px 10px;font-weight:600;border:1px solid #ddd;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#555}
td{padding:6px 10px;border:1px solid #e8e8e8;vertical-align:top;line-height:1.5}
tr:nth-child(even) td{background:#fafafa}
.footer{margin-top:48px;padding-top:14px;border-top:1px solid #e5e5e5;display:flex;justify-content:space-between;font-size:11px;color:#999}
.print-btn{color:#555;text-decoration:none;font-weight:500;border:1px solid #ddd;padding:4px 12px;border-radius:4px;font-size:11px}
@media print{.no-print{display:none}body{padding:16px}}
</style></head><body>
<div class="hdr">
  <div class="hdr-l"><div class="badge">ISO 27001:2022</div><h1>${title}</h1><div class="sub">${subtitle}</div></div>
  <div class="hdr-r"><strong>${orgName}</strong><br>Generated: ${dateStr}<br>Mosaic AI Platform<br>🔒 Confidential</div>
</div>
${sectionsHtml}
<div class="footer">
  <span>Generated by Mosaic — ${new Date().toISOString()}</span>
  <span class="no-print"><a class="print-btn" href="javascript:window.print()">🖨 Print / Save as PDF</a></span>
  <span>CONFIDENTIAL — Internal use only</span>
</div>
</body></html>`
}
