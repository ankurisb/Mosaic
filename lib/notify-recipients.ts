// Notification recipient resolution.
//
// A notification group's `members` array is a hybrid list — each entry is one of:
//   { type: 'email',  address }            raw email contact (external, no account)
//   { type: 'phone',  number }             raw phone contact (E.164)
//   { type: 'user',   user_id }            reference to a users row — email is
//                                          resolved LIVE from that user, so a
//                                          changed/removed address is always current
//   { type: 'role',   role }               every active user with this role
//
// This module expands those into concrete { kind, address } targets and,
// crucially, reports every member it could NOT deliver to and WHY — rather than
// silently skipping (which for an alerting system means people who should be
// notified simply aren't, with no trace).
//
// Note on the users table: it carries email + role + banned (no phone column
// yet), so a user/role member resolves to EMAIL only. Add a users.phone column
// to enable SMS-to-user; raw { type:'phone' } contacts still work for SMS.

export type ChannelKind = 'email' | 'phone'

export interface ResolvedTarget {
  kind: ChannelKind
  address: string          // email address or E.164 phone number
  via: string              // human label of where this came from (for logs)
}

export interface SkippedRecipient {
  descriptor: string       // human label of the member that was skipped
  reason: string           // why it couldn't be delivered
}

export interface ResolutionResult {
  targets: ResolvedTarget[]
  skipped: SkippedRecipient[]
}

type Member = Record<string, unknown>
type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>

/** Describe a member for logs without leaking more than necessary. */
function describeMember(m: Member): string {
  const t = String(m.type || 'unknown')
  if (t === 'email') return `email:${m.address ?? '?'}`
  if (t === 'phone') return `phone:${m.number ?? '?'}`
  if (t === 'user')  return `user:${m.label ?? m.user_id ?? '?'}`
  if (t === 'role')  return `role:${m.role ?? '?'}`
  if (t === 'group') return `group:${m.label ?? m.group_id ?? '?'}`
  return `${t}:?`
}

/**
 * Expand a single group's member list into deliverable targets + skip reasons.
 * `sql` is the app DB client. Nested groups are NOT expanded here (a member of
 * type 'group' inside a group is reported as skipped with a clear reason, to
 * avoid unbounded recursion / cycles); groups are referenced at the rule level.
 */
export async function resolveGroupMembers(
  sql: SqlClient,
  members: Member[],
): Promise<ResolutionResult> {
  const targets: ResolvedTarget[] = []
  const skipped: SkippedRecipient[] = []

  for (const m of members) {
    const type = String(m.type || '')
    const descriptor = describeMember(m)

    if (type === 'email') {
      const addr = String(m.address || '').trim()
      if (!addr || !addr.includes('@')) { skipped.push({ descriptor, reason: 'missing or invalid email address' }); continue }
      targets.push({ kind: 'email', address: addr, via: 'contact' })

    } else if (type === 'phone') {
      const num = String(m.number || '').trim()
      if (!num || !num.startsWith('+')) { skipped.push({ descriptor, reason: 'missing or non-E.164 phone number' }); continue }
      targets.push({ kind: 'phone', address: num, via: 'contact' })

    } else if (type === 'user') {
      const uid = String(m.user_id || '').trim()
      if (!uid) { skipped.push({ descriptor, reason: 'user member has no user_id' }); continue }
      let rows: Record<string, unknown>[] = []
      try { rows = await sql`SELECT id, email, banned FROM users WHERE id = ${uid}` } catch { rows = [] }
      const u = rows[0]
      if (!u) { skipped.push({ descriptor, reason: 'user no longer exists' }); continue }
      if (u.banned === true || u.banned === 1) { skipped.push({ descriptor, reason: 'user is deactivated' }); continue }
      const email = String(u.email || '').trim()
      if (email && email.includes('@')) targets.push({ kind: 'email', address: email, via: `user ${u.email}` })
      else skipped.push({ descriptor, reason: 'user has no usable email on file' })

    } else if (type === 'role') {
      const role = String(m.role || '').trim()
      if (!role) { skipped.push({ descriptor, reason: 'role member has no role' }); continue }
      let rows: Record<string, unknown>[] = []
      try { rows = await sql`SELECT email, banned FROM users WHERE role = ${role}` } catch { rows = [] }
      const activeRows = rows.filter(u => u.banned !== true && u.banned !== 1)
      if (!activeRows.length) { skipped.push({ descriptor, reason: `no active users with role "${role}"` }); continue }
      let any = false
      for (const u of activeRows) {
        const email = String(u.email || '').trim()
        if (email && email.includes('@')) { targets.push({ kind: 'email', address: email, via: `role ${role}` }); any = true }
      }
      if (!any) skipped.push({ descriptor, reason: `users with role "${role}" have no usable email on file` })

    } else if (type === 'group') {
      // Nested group inside a group — not expanded (avoids recursion/cycles).
      skipped.push({ descriptor, reason: 'nested groups are not supported; reference the group at the rule level' })

    } else {
      skipped.push({ descriptor, reason: `unknown member type "${type}"` })
    }
  }

  // De-duplicate targets (same address can arrive via user + role + contact).
  const seen = new Set<string>()
  const deduped: ResolvedTarget[] = []
  for (const t of targets) {
    const key = `${t.kind}:${t.address.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(t)
  }

  return { targets: deduped, skipped }
}
