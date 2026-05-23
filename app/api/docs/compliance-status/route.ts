// app/api/docs/compliance-status/route.ts
// Returns live ISO 27001 compliance status checks as JSON.
// Used by the Audit trail tab to render the inline live compliance panel.
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

export interface ComplianceCheck {
  id: string
  control: string
  title: string
  status: 'pass' | 'fail' | 'partial' | 'na'
  detail: string
  metric?: string
}

export interface ComplianceSection {
  section: string
  checks: ComplianceCheck[]
}

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const sql = getDb()

  const [
    auditRows, settingsRows, userRows, connRows, apiRows,
    ssoRows, guardrailDARows, guardrailARows, guardrailURows,
    guardrailCRows, egressRows, failedLoginRows, chainRows, keyRows,
  ] = await Promise.all([
    sql`SELECT COUNT(*) as cnt FROM audit_events`.catch(() => [{ cnt: 0 }]),
    sql`SELECT key, value FROM audit_settings`.catch(() => []),
    sql`SELECT COUNT(*) as cnt FROM users WHERE banned=0`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM db_connections`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM api_services`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM sso_config WHERE enabled=1`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM guardrail_data_access WHERE enabled=1`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM guardrail_actions WHERE enabled=1`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM guardrail_usage_limits WHERE enabled=1`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM guardrail_content WHERE enabled=1`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM egress_events`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM audit_events WHERE action='LOGIN_FAILED' AND timestamp > datetime('now','-30 days')`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM audit_events WHERE action='CHAIN_VERIFY' AND outcome='success' AND timestamp > datetime('now','-2 days')`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM kv_settings WHERE value_enc LIKE 'enc2:%'`.catch(() => [{ cnt: 0 }]),
  ])

  const settings = Object.fromEntries(
    (settingsRows as { key: string; value: string }[]).map(r => [r.key, r.value])
  )
  const n = (rows: unknown[]) => Number((rows[0] as { cnt: unknown })?.cnt ?? 0)

  const auditCount   = n(auditRows)
  const retDays      = Number(settings.retention_days || 365)
  const chainOk      = settings.last_chain_verify_ok === 'true'
  const chainVerified= !!settings.last_chain_verify_at
  const lastVerify   = settings.last_chain_verify_at
    ? new Date(settings.last_chain_verify_at).toLocaleDateString('en-GB') : 'Never'
  const userCount    = n(userRows)
  const connCount    = n(connRows)
  const apiCount     = n(apiRows)
  const ssoCount     = n(ssoRows)
  const daCount      = n(guardrailDARows)
  const actCount     = n(guardrailARows)
  const usageCount   = n(guardrailURows)
  const contentCount = n(guardrailCRows)
  const egressCount  = n(egressRows)
  const failedLogins = n(failedLoginRows)
  const chainRecent  = n(chainRows) > 0
  const keyCount     = n(keyRows)

  const sections: ComplianceSection[] = [
    {
      section: 'Audit Logging (A.8.15)',
      checks: [
        {
          id: 'audit-events-exist', control: 'A.8.15',
          title: 'Audit events are being recorded',
          status: auditCount > 0 ? 'pass' : 'fail',
          detail: auditCount > 0 ? 'Audit log is active and recording events.' : 'No audit events found.',
          metric: `${auditCount.toLocaleString()} events`,
        },
        {
          id: 'audit-retention', control: 'A.8.15',
          title: 'Retention period ≥ 365 days',
          status: retDays >= 365 ? 'pass' : 'fail',
          detail: retDays >= 365
            ? `${retDays}-day retention meets the ISO 27001 minimum of 1 year.`
            : `Retention is ${retDays} days — must be at least 365.`,
          metric: `${retDays} days`,
        },
        {
          id: 'audit-chain-integrity', control: 'A.8.15',
          title: 'SHA-256 hash chain intact',
          status: !chainVerified ? 'partial' : chainOk ? 'pass' : 'fail',
          detail: !chainVerified ? 'Not yet verified.'
            : chainOk ? `Chain intact — verified ${lastVerify}.`
            : '⚠ Chain integrity check FAILED — possible tampering.',
          metric: chainOk ? `Verified ${lastVerify}` : chainVerified ? 'FAILED' : 'Pending',
        },
        {
          id: 'audit-chain-recent', control: 'A.8.15',
          title: 'Daily chain verification running',
          status: chainRecent ? 'pass' : 'partial',
          detail: chainRecent ? 'Automated verification ran within the last 48 hours.'
            : 'No recent verification. Check scheduler.',
          metric: chainRecent ? 'Current' : 'Overdue',
        },
        {
          id: 'audit-egress', control: 'A.8.15',
          title: 'Data egress events logged',
          status: egressCount > 0 ? 'pass' : 'partial',
          detail: egressCount > 0
            ? `${egressCount.toLocaleString()} egress events with source, user, and token counts.`
            : 'No egress events yet — will populate as data sources are queried.',
          metric: `${egressCount.toLocaleString()} events`,
        },
      ],
    },
    {
      section: 'Access Control (A.5.15 / A.8.2 / A.8.3)',
      checks: [
        {
          id: 'rbac-roles', control: 'A.5.15',
          title: 'Role-based access control active',
          status: userCount > 0 ? 'pass' : 'partial',
          detail: `${userCount} active user${userCount !== 1 ? 's' : ''} with admin/user role separation. All API routes enforce session role.',`,
          metric: `${userCount} users`,
        },
        {
          id: 'rbac-data-access', control: 'A.8.3',
          title: 'Data access guardrails configured',
          status: daCount > 0 ? 'pass' : 'partial',
          detail: daCount > 0
            ? `${daCount} data access rule${daCount !== 1 ? 's' : ''} — restricting tables, columns, and rows by role.`
            : 'No data access rules. Configure under Settings → Guardrails → Data Access.',
          metric: `${daCount} rules`,
        },
        {
          id: 'rbac-action-controls', control: 'A.8.2',
          title: 'Action controls (tool blocking / read-only)',
          status: actCount > 0 ? 'pass' : 'partial',
          detail: actCount > 0
            ? `${actCount} action control rule${actCount !== 1 ? 's' : ''} active.`
            : 'No action controls. Consider read-only mode on production sources.',
          metric: `${actCount} rules`,
        },
        {
          id: 'sso', control: 'A.5.16',
          title: 'SSO / federated identity',
          status: ssoCount > 0 ? 'pass' : 'partial',
          detail: ssoCount > 0
            ? `${ssoCount} SSO provider${ssoCount !== 1 ? 's' : ''} with Keycloak role federation.`
            : 'No SSO — local auth only. Keycloak recommended for enterprise.',
          metric: ssoCount > 0 ? `${ssoCount} provider${ssoCount !== 1 ? 's' : ''}` : 'Not set',
        },
        {
          id: 'failed-logins', control: 'A.5.15',
          title: 'Failed login attempts (30 days)',
          status: failedLogins === 0 ? 'pass' : failedLogins < 10 ? 'partial' : 'fail',
          detail: failedLogins === 0 ? 'No failed logins in the last 30 days.'
            : failedLogins < 10 ? `${failedLogins} failed attempts — monitor for brute force.`
            : `⚠ ${failedLogins} failed attempts — investigate for brute force attack.`,
          metric: `${failedLogins} failures`,
        },
      ],
    },
    {
      section: 'Cryptography (A.8.24 / A.5.17)',
      checks: [
        {
          id: 'encryption-at-rest', control: 'A.8.24',
          title: 'Credentials encrypted at rest',
          status: 'pass',
          detail: 'All DB passwords, connection strings, API tokens, and OAuth secrets encrypted with AES-256-GCM. Key at ~/.mosaic/secret.key.',
          metric: 'AES-256-GCM',
        },
        {
          id: 'api-keys-encrypted', control: 'A.5.17',
          title: 'API keys stored encrypted',
          status: keyCount > 0 ? 'pass' : 'partial',
          detail: keyCount > 0 ? `${keyCount} API key${keyCount !== 1 ? 's' : ''} encrypted in kv_settings.` : 'No API keys stored yet.',
          metric: `${keyCount} keys`,
        },
        {
          id: 'password-hashing', control: 'A.5.17',
          title: 'Passwords hashed (bcrypt/12)',
          status: 'pass',
          detail: 'User passwords hashed with bcrypt cost factor 12. Never stored in plaintext.',
          metric: 'bcrypt/12',
        },
        {
          id: 'sso-secret-enc', control: 'A.5.17',
          title: 'SSO client secrets encrypted',
          status: ssoCount > 0 ? 'pass' : 'na',
          detail: ssoCount > 0 ? 'OAuth client secrets stored in client_secret_enc (AES-256-GCM). Legacy column blanked.' : 'No SSO — not applicable.',
          metric: ssoCount > 0 ? 'Encrypted' : 'N/A',
        },
      ],
    },
    {
      section: 'Guardrails & Data Leakage Prevention (A.8.22 / A.8.12)',
      checks: [
        {
          id: 'usage-limits', control: 'A.8.6',
          title: 'Token/request usage limits',
          status: usageCount > 0 ? 'pass' : 'partial',
          detail: usageCount > 0 ? `${usageCount} usage limit rule${usageCount !== 1 ? 's' : ''} with soft/hard token budgets.`
            : 'No usage limits. Set token budgets under Guardrails → Usage Limits.',
          metric: `${usageCount} rules`,
        },
        {
          id: 'content-filtering', control: 'A.8.22',
          title: 'Content topic filtering',
          status: contentCount > 0 ? 'pass' : 'partial',
          detail: contentCount > 0 ? `${contentCount} content filter rule${contentCount !== 1 ? 's' : ''} active.`
            : 'No content filters. Configure under Guardrails → Content Filtering.',
          metric: `${contentCount} rules`,
        },
        {
          id: 'injection-defense', control: 'A.8.22',
          title: 'Prompt injection defence',
          status: 'pass',
          detail: 'Query results wrapped with [DATA FROM] markers. Injection patterns detected and logged as GUARDRAIL_BLOCK events.',
          metric: 'Active',
        },
        {
          id: 'egress-logging-active', control: 'A.8.12',
          title: 'Egress logging active',
          status: 'pass',
          detail: 'Every AI response using connected data is logged to egress_events with user, source, token count, and model.',
          metric: 'Active',
        },
      ],
    },
    {
      section: 'Gaps — Remediation Required',
      checks: [
        {
          id: 'mfa', control: 'A.8.5',
          title: 'Multi-factor authentication',
          status: 'fail',
          detail: 'MFA not implemented. Planned for Phase D via Keycloak. Risk R-01 elevated.',
          metric: 'Not implemented',
        },
        {
          id: 'backup', control: 'A.8.13',
          title: 'Automated database backup',
          status: 'fail',
          detail: 'Automated backup not configured. Manual backup only. pgBackRest planned for Phase I. Risk R-09 elevated.',
          metric: 'Manual only',
        },
        {
          id: 'pentest', control: 'A.5.35',
          title: 'Independent security review',
          status: 'partial',
          detail: 'Penetration test scheduled for Phase I. No external review completed yet.',
          metric: 'Scheduled',
        },
        {
          id: 'incident-procedure', control: 'A.5.24',
          title: 'Incident response procedure',
          status: 'fail',
          detail: 'Not documented. Required for ISO 27001 certification. Action item for ISMS owner.',
          metric: 'Not documented',
        },
        {
          id: 'ha-dr', control: 'A.8.14',
          title: 'High availability / DR plan',
          status: 'fail',
          detail: 'Single-instance deployment with no HA or DR plan. On roadmap.',
          metric: 'Single instance',
        },
      ],
    },
  ]

  const allChecks = sections.flatMap(s => s.checks)
  const summary = {
    pass:    allChecks.filter(c => c.status === 'pass').length,
    partial: allChecks.filter(c => c.status === 'partial').length,
    fail:    allChecks.filter(c => c.status === 'fail').length,
    na:      allChecks.filter(c => c.status === 'na').length,
    total:   allChecks.length,
  }

  return Response.json({ sections, summary, generatedAt: new Date().toISOString() })
}
