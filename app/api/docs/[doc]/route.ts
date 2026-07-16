// app/api/docs/[doc]/route.ts
// Generates live ISO 27001 compliance documents as HTML (print to PDF).
// Auto-populated with real data from the database — always current.
//
// GET /api/docs/retention-policy   — Retention Policy Statement (A.8.15)
// GET /api/docs/risk-assessment     — Information Security Risk Assessment (6.1.2)
// GET /api/docs/training-records    — Staff Awareness Training Records (A.6.3)

import { getSession } from '@/lib/auth'
import { getDb, intervalAgo } from '@/lib/db'
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
      sql`SELECT COUNT(*) as cnt FROM users WHERE banned = false`.catch(() => [{ cnt: '0' }]),
      sql`SELECT COUNT(*) as cnt FROM db_connections`.catch(() => [{ cnt: '0' }]),
      sql`SELECT COUNT(*) as cnt FROM api_services`.catch(() => [{ cnt: '0' }]),
      sql`SELECT COUNT(*) as cnt FROM audit_events WHERE action = 'LOGIN_FAILED' AND timestamp > ${intervalAgo(30, 'days')}`.catch(() => [{ cnt: '0' }]),
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
      SELECT email, name, role, created_at FROM users WHERE banned = false ORDER BY created_at ASC
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

  } else if (doc === 'isms-policy') {
    html = buildDoc({ title: 'Information Security Policy', subtitle: 'ISO 27001:2022 — Clause 5.2', dateStr, orgName, sections: [
      { heading: '1. Policy Statement',
        body: `${orgName} is committed to protecting the confidentiality, integrity, and availability of all information assets it owns or is entrusted to manage. This policy establishes the framework for the Information Security Management System (ISMS) and applies to all personnel, systems, and third parties operating within its scope.` },
      { heading: '2. Scope',
        body: `This policy applies to all information processed, stored, or transmitted by the Mosaic AI intelligence platform and supporting infrastructure at ${orgName}, including:<br><br>
• All data ingested from connected databases and APIs<br>
• Conversation history and AI-generated outputs<br>
• User credentials and access control records<br>
• Audit logs and compliance records<br>
• Configuration and encryption keys` },
      { heading: '3. Information Security Objectives',
        table: [
          ['Objective', 'Measure', 'Target'],
          ['Prevent unauthorised access', 'Failed login attempts per month', '< 5'],
          ['Maintain audit trail integrity', 'Hash chain verification result', '100% pass'],
          ['Ensure log retention compliance', 'Days of audit log retained', '≥ 365'],
          ['Respond to incidents promptly', 'Time to notify affected parties', '< 72 hours'],
          ['Train all personnel', 'Staff with completed security training', '100%'],
        ] },
      { heading: '4. Roles and Responsibilities',
        table: [
          ['Role', 'Responsibility'],
          ['Senior Management', 'Approve and resource the ISMS; sign this policy annually'],
          ['Information Security Manager', 'Maintain the ISMS; conduct risk assessments; manage incidents'],
          ['System Administrator', 'Implement technical controls; maintain audit logs; manage access'],
          ['All Users', 'Complete security awareness training; report incidents; follow acceptable use policy'],
        ] },
      { heading: '5. Key Principles',
        body: `<strong>Least Privilege:</strong> Users are granted only the access necessary for their role. Privileged access (admin) is strictly controlled and audited.<br><br>
<strong>Need to Know:</strong> Sensitive data is accessible only to those with a legitimate business need.<br><br>
<strong>Defence in Depth:</strong> Multiple layers of control (authentication, encryption, audit logging, content guardrails) protect information assets.<br><br>
<strong>Accountability:</strong> All significant actions are logged with actor identity, timestamp, and outcome. The audit log is tamper-evident via SHA-256 hash chain.<br><br>
<strong>Continuous Improvement:</strong> The ISMS is reviewed annually and after significant incidents or changes.` },
      { heading: '6. Compliance',
        body: `All personnel must comply with this policy and the supporting policies listed below. Violations may result in disciplinary action up to and including termination. Suspected violations must be reported to the Information Security Manager immediately.<br><br>
Supporting policies and procedures:<br>
• Audit Log Retention Policy (A.8.15)<br>
• Risk Assessment (6.1.2)<br>
• Staff Awareness Training Records (A.6.3)<br>
• Statement of Applicability (6.1.3)<br>
• Acceptable Use Policy (to be maintained separately)<br>
• Incident Response Procedure (to be maintained separately)` },
      { heading: '7. Review',
        body: `This policy will be reviewed annually by the Information Security Manager and approved by Senior Management. It will also be reviewed following any significant security incident or material change to the Mosaic deployment.` },
      { heading: '8. Approval and Sign-off',
        table: [
          ['Role', 'Name', 'Date', 'Signature'],
          ['Chief Executive / Senior Management', '', dateStr, '________________'],
          ['Information Security Manager', '', '', '________________'],
          ['Document Owner', '', '', '________________'],
        ] },
      { heading: '9. Document Control',
        table: [
          ['Version', 'Date', 'Author', 'Change'],
          ['1.0', dateStr, 'System-generated skeleton', 'Initial draft — requires management review and signature'],
        ] },
      { heading: '⚠ Important Note',
        body: `This document is a <strong>skeleton template</strong> generated by the Mosaic platform. Before use in a certification audit it must be reviewed by management, tailored to reflect the organisation's actual security posture, and signed by an authorised representative. The objectives and role names should be updated to reflect ${orgName}'s actual organisational structure.` },
    ]})

  } else if (doc === 'statement-of-applicability') {
    // Pull live controls status from what Mosaic has implemented
    const [uR, cR] = await Promise.all([
      sql`SELECT COUNT(*) as cnt FROM users WHERE banned = false`.catch(() => [{ cnt: '0' }]),
      sql`SELECT COUNT(*) as cnt FROM db_connections`.catch(() => [{ cnt: '0' }]),
    ])
    const userCount = (uR[0] as { cnt: string })?.cnt || '0'
    const connCount = (cR[0] as { cnt: string })?.cnt || '0'

    // All 93 Annex A controls for ISO 27001:2022 with applicability
    const controls: string[][] = [
      ['Ref', 'Control Name', 'Applicable', 'Implemented', 'Justification / Evidence'],
      // A.5 — Organisational controls
      ['A.5.1',  'Policies for information security',              'Yes', 'Partial',  'ISMS Policy document (this SoA); full policy suite in progress'],
      ['A.5.2',  'Information security roles and responsibilities', 'Yes', 'Partial',  'Admin/user roles in Mosaic; formal RACI to be documented'],
      ['A.5.3',  'Segregation of duties',                          'Yes', 'Partial',  'Admin vs user role separation; further segregation planned'],
      ['A.5.4',  'Management responsibilities',                    'Yes', 'No',       'Requires management sign-off on ISMS Policy'],
      ['A.5.5',  'Contact with authorities',                       'Yes', 'No',       'Incident response procedure to be documented'],
      ['A.5.6',  'Contact with special interest groups',           'No',  'N/A',      'Not applicable at current scale'],
      ['A.5.7',  'Threat intelligence',                            'Yes', 'Partial',  'Risk assessment maintained; formal threat intel feed not yet active'],
      ['A.5.8',  'IS in project management',                       'Yes', 'Partial',  'Security considered in Mosaic roadmap phases'],
      ['A.5.9',  'Inventory of information and other assets',      'Yes', 'Yes',      `Asset inventory in Risk Assessment (${connCount} DBs, ${userCount} users)`],
      ['A.5.10', 'Acceptable use of information and other assets', 'Yes', 'Partial',  'Training records cover acceptable use; standalone policy needed'],
      ['A.5.11', 'Return of assets',                               'Yes', 'No',       'Offboarding procedure to be documented'],
      ['A.5.12', 'Classification of information',                  'Yes', 'Partial',  'Classification levels defined in training records (Confidential/Restricted)'],
      ['A.5.13', 'Labelling of information',                       'Yes', 'Partial',  'Documents marked Confidential; system-wide labelling not yet enforced'],
      ['A.5.14', 'Information transfer',                           'Yes', 'Partial',  'Egress logging (egress_events); formal transfer policy needed'],
      ['A.5.15', 'Access control',                                 'Yes', 'Yes',      'Role-based access control (admin/user); session tokens; admin-only routes'],
      ['A.5.16', 'Identity management',                            'Yes', 'Partial',  'Local identity store; SSO/LDAP planned (Phase D roadmap)'],
      ['A.5.17', 'Authentication information',                     'Yes', 'Yes',      'bcrypt password hashing; AES-256-GCM credential encryption; API key SHA-256'],
      ['A.5.18', 'Access rights',                                  'Yes', 'Yes',      'Role-based rights; USER_ROLE_CHANGE audited; access revocation on ban/delete'],
      ['A.5.19', 'IS in supplier relationships',                   'Yes', 'Partial',  'Anthropic API usage; supplier assessment to be documented'],
      ['A.5.20', 'Addressing IS within supplier agreements',       'Yes', 'Partial',  'Anthropic DPA/ToS reviewed; formal supplier register needed'],
      ['A.5.21', 'Managing IS in the ICT supply chain',            'Yes', 'Partial',  'npm dependency review; SBOM not yet generated'],
      ['A.5.22', 'Monitoring/review/change management of services','Yes', 'Partial',  'Health endpoint monitors services; formal review process needed'],
      ['A.5.23', 'IS for use of cloud services',                   'Yes', 'Yes',      'Mosaic is on-premise; Anthropic API governed by ToS; audit log covers AI calls'],
      ['A.5.24', 'IS incident management planning',                'Yes', 'No',       'Incident response procedure to be documented'],
      ['A.5.25', 'Assessment and decision on IS events',           'Yes', 'Partial',  'LOGIN_FAILED and chain-break alerts logged; triage process needed'],
      ['A.5.26', 'Response to IS incidents',                       'Yes', 'No',       'Procedure to be documented'],
      ['A.5.27', 'Learning from IS incidents',                     'Yes', 'No',       'Post-incident review process to be established'],
      ['A.5.28', 'Collection of evidence',                         'Yes', 'Yes',      'Hash-chained audit log; tamper-evident; CSV export for forensics'],
      ['A.5.29', 'IS during disruption',                           'Yes', 'Partial',  'Single-instance deployment; HA/DR on roadmap'],
      ['A.5.30', 'ICT readiness for business continuity',          'Yes', 'No',       'DR plan to be documented; backup automation on roadmap (Phase I)'],
      ['A.5.31', 'Legal, statutory, regulatory requirements',      'Yes', 'Partial',  'GDPR data handling considered; formal legal register needed'],
      ['A.5.32', 'Intellectual property rights',                   'Yes', 'Partial',  'Open-source licence review needed for npm dependencies'],
      ['A.5.33', 'Protection of records',                          'Yes', 'Yes',      'Audit logs retained ≥365 days; hash chain protects integrity'],
      ['A.5.34', 'Privacy and protection of PII',                  'Yes', 'Partial',  'PII not stored by design; GDPR training in awareness programme'],
      ['A.5.35', 'Independent review of IS',                       'Yes', 'No',       'Penetration test scheduled (Phase I roadmap)'],
      ['A.5.36', 'Compliance with policies and standards',         'Yes', 'Partial',  'Mosaic technical controls align with this SoA; internal audit needed (Clause 9.2)'],
      ['A.5.37', 'Documented operating procedures',                'Yes', 'Partial',  'Key procedures in Mosaic codebase; operational runbooks needed'],
      // A.6 — People controls
      ['A.6.1',  'Screening',                                      'Yes', 'No',       'Background check process to be established for admin roles'],
      ['A.6.2',  'Terms and conditions of employment',             'Yes', 'No',       'IS responsibilities to be included in employment contracts'],
      ['A.6.3',  'IS awareness/education/training',                'Yes', 'Yes',      'Training records document generated; programme defined'],
      ['A.6.4',  'Disciplinary process',                           'Yes', 'No',       'To be referenced in HR policy'],
      ['A.6.5',  'Responsibilities after termination',             'Yes', 'Partial',  'User ban/delete in Mosaic; formal offboarding checklist needed'],
      ['A.6.6',  'Confidentiality or non-disclosure agreements',   'Yes', 'No',       'NDAs to cover access to Mosaic data'],
      ['A.6.7',  'Remote working',                                 'Yes', 'Partial',  'HTTPS enforced; VPN guidance to be provided'],
      ['A.6.8',  'IS event reporting',                             'Yes', 'No',       'Reporting channel to be established; covered in training module'],
      // A.7 — Physical controls
      ['A.7.1',  'Physical security perimeters',                   'Yes', 'No',       'Data centre / server room controls — to be assessed per deployment site'],
      ['A.7.2',  'Physical entry',                                 'Yes', 'No',       'Physical access controls — to be assessed per deployment site'],
      ['A.7.3',  'Securing offices, rooms and facilities',         'Yes', 'No',       'Per deployment site'],
      ['A.7.4',  'Physical security monitoring',                   'Yes', 'No',       'Per deployment site'],
      ['A.7.5',  'Protecting against physical and environmental threats', 'Yes', 'No','Per deployment site'],
      ['A.7.6',  'Working in secure areas',                        'Yes', 'No',       'Per deployment site'],
      ['A.7.7',  'Clear desk and clear screen',                    'Yes', 'No',       'Policy to be communicated to users'],
      ['A.7.8',  'Equipment siting and protection',                'Yes', 'No',       'Per deployment site'],
      ['A.7.9',  'Security of assets off-premises',                'Yes', 'No',       'Per deployment site'],
      ['A.7.10', 'Storage media',                                  'Yes', 'Partial',  'Database encryption at rest considered; formal media policy needed'],
      ['A.7.11', 'Supporting utilities',                           'Yes', 'No',       'UPS / power resilience — per deployment site'],
      ['A.7.12', 'Cabling security',                               'Yes', 'No',       'Per deployment site'],
      ['A.7.13', 'Equipment maintenance',                          'Yes', 'No',       'Server maintenance schedule to be established'],
      ['A.7.14', 'Secure disposal or re-use of equipment',         'Yes', 'No',       'Data destruction procedure to be documented'],
      // A.8 — Technological controls
      ['A.8.1',  'User endpoint devices',                          'Yes', 'Partial',  'Browser-based access; endpoint management policy needed'],
      ['A.8.2',  'Privileged access rights',                       'Yes', 'Yes',      'Admin role; USER_ROLE_CHANGE, USER_BAN audited; principle of least privilege'],
      ['A.8.3',  'Information access restriction',                 'Yes', 'Yes',      'Role-based data access; read-only DB mode; connection scoping'],
      ['A.8.4',  'Access to source code',                          'Yes', 'Partial',  'GitHub repo; branch protection and code review to be enforced'],
      ['A.8.5',  'Secure authentication',                          'Yes', 'Partial',  'Password hashing (bcrypt); MFA planned (Phase D roadmap)'],
      ['A.8.6',  'Capacity management',                            'Yes', 'Partial',  'Token budget guardrails; infrastructure sizing to be documented'],
      ['A.8.7',  'Protection against malware',                     'Yes', 'Partial',  'Content guardrails; prompt injection defence; endpoint AV per deployment'],
      ['A.8.8',  'Management of technical vulnerabilities',        'Yes', 'Partial',  'npm audit in CI; penetration test scheduled (Phase I)'],
      ['A.8.9',  'Configuration management',                       'Yes', 'Partial',  'Docker Compose; env var management; formal baseline config needed'],
      ['A.8.10', 'Information deletion',                           'Yes', 'Yes',      'Nightly audit purge; user delete removes data; retention policy enforced'],
      ['A.8.11', 'Data masking',                                   'Yes', 'Partial',  'Sensitive fields redacted in audit detail; full data masking policy needed'],
      ['A.8.12', 'Data leakage prevention',                        'Yes', 'Yes',      'Egress logging; content guardrails; query row limits; injection defence'],
      ['A.8.13', 'Information backup',                             'Yes', 'No',       'Manual backup only — automated backup on roadmap (Phase I / pgBackRest)'],
      ['A.8.14', 'Redundancy of information processing facilities', 'Yes', 'No',      'Single instance; HA architecture on roadmap'],
      ['A.8.15', 'Logging',                                        'Yes', 'Yes',      'Hash-chained audit_events; daily CHAIN_VERIFY; 365-day retention; CSV export'],
      ['A.8.16', 'Monitoring activities',                          'Yes', 'Yes',      'Health endpoint; System Health tab; Pino structured logging; log viewer'],
      ['A.8.17', 'Clock synchronisation',                          'Yes', 'Yes',      'Server UTC timestamps; ISO 8601 in all audit records'],
      ['A.8.18', 'Use of privileged utility programs',             'Yes', 'Partial',  'Admin-only API routes; DB direct access restricted'],
      ['A.8.19', 'Installation of software on operational systems','Yes', 'Partial',  'Docker Compose controls deployments; change management process needed'],
      ['A.8.20', 'Networks security',                              'Yes', 'Partial',  'On-premise deployment; network segmentation per deployment site'],
      ['A.8.21', 'Security of network services',                   'Yes', 'Partial',  'HTTPS in production; internal service auth; formal network policy needed'],
      ['A.8.22', 'Segregation of networks',                        'Yes', 'Partial',  'Docker network isolation; further segmentation per deployment'],
      ['A.8.23', 'Web filtering',                                  'Yes', 'Partial',  'Content guardrails filter AI outputs; web filtering per deployment'],
      ['A.8.24', 'Use of cryptography',                            'Yes', 'Yes',      'AES-256-GCM for credentials; bcrypt for passwords; SHA-256 for audit chain'],
      ['A.8.25', 'Secure development life cycle',                  'Yes', 'Partial',  'Security considered in roadmap; formal SDLC policy needed'],
      ['A.8.26', 'Application security requirements',              'Yes', 'Partial',  'Auth on all routes; input validation; formal AppSec requirements doc needed'],
      ['A.8.27', 'Secure system architecture and engineering',     'Yes', 'Partial',  'Layered architecture; threat model to be formally documented'],
      ['A.8.28', 'Secure coding',                                  'Yes', 'Partial',  'TypeScript strict mode; linting; formal secure coding guidelines needed'],
      ['A.8.29', 'Security testing in development and acceptance', 'Yes', 'Partial',  'Manual testing; automated test harness on roadmap (Phase A)'],
      ['A.8.30', 'Outsourced development',                         'No',  'N/A',      'No outsourced development at this time'],
      ['A.8.31', 'Separation of development, test and production', 'Yes', 'Partial',  'Sandbox DB for testing; environment tagging (production/staging/dev)'],
      ['A.8.32', 'Change management',                              'Yes', 'Partial',  'Git-based change control; formal change approval process needed'],
      ['A.8.33', 'Test information',                               'Yes', 'Yes',      'Sandbox DB with synthetic manufacturing data; no production data in tests'],
      ['A.8.34', 'Protection of IS during audit testing',          'Yes', 'Yes',      'Audit log read-only via API; no direct DB write access for auditors'],
    ]

    html = buildDoc({ title: 'Statement of Applicability', subtitle: 'ISO 27001:2022 — Clause 6.1.3', dateStr, orgName, sections: [
      { heading: '1. Purpose',
        body: `This Statement of Applicability (SoA) lists all ISO 27001:2022 Annex A controls and declares whether each is applicable to ${orgName}'s Mosaic deployment, the implementation status, and the justification. It is prepared in accordance with Clause 6.1.3(d) and forms part of the ISMS documentation set.` },
      { heading: '2. Scope',
        body: `This SoA covers the Mosaic AI intelligence platform and all connected systems, data sources, and personnel at ${orgName}. Controls marked "N/A" are not applicable to this scope with justification provided.` },
      { heading: '3. Implementation Summary',
        table: [
          ['Status', 'Count', 'Description'],
          ['Yes — Implemented', controls.slice(1).filter(r => r[3] === 'Yes').length.toString(), 'Control fully in place'],
          ['Partial', controls.slice(1).filter(r => r[3] === 'Partial').length.toString(), 'Control partially implemented — see justification for gap'],
          ['No', controls.slice(1).filter(r => r[3] === 'No' && r[2] === 'Yes').length.toString(), 'Applicable but not yet implemented — remediation required'],
          ['N/A', controls.slice(1).filter(r => r[2] === 'No').length.toString(), 'Not applicable — justified exclusion'],
        ] },
      { heading: '4. Annex A Controls',
        table: controls },
      { heading: '5. Exclusions Summary',
        body: `The following controls have been excluded as not applicable to the current scope:<br><br>
<strong>A.5.6 (Contact with special interest groups):</strong> Not applicable at current organisational scale.<br>
<strong>A.8.30 (Outsourced development):</strong> All development is performed in-house.` },
      { heading: '6. Review and Approval',
        table: [
          ['Role', 'Name', 'Date', 'Signature'],
          ['ISMS Owner', '', dateStr, '________________'],
          ['Information Security Manager', '', '', '________________'],
          ['Senior Management', '', '', '________________'],
        ] },
      { heading: '7. Document Control',
        table: [
          ['Version', 'Date', 'Change'],
          ['1.0', dateStr, 'Initial version — generated from Mosaic platform; requires ISMS owner review'],
        ] },
      { heading: '⚠ Important Note',
        body: `Controls marked <strong>Partial</strong> or <strong>No</strong> represent genuine gaps. The Information Security Manager must create remediation tasks for all applicable unimplemented controls and track progress. This document should be reviewed by the ISMS owner before submission to a certification body.` },
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
