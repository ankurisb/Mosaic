// lib/password-policy.ts
// Single source of truth for what counts as an acceptable user-chosen password.
// Applied at every point where a human picks a password (setup wizard, self
// change, admin-supplied invite password). NOT applied to auto-generated temp
// passwords, which are random and already strong.
//
// Deliberately modest: a length floor plus a couple of composition checks and a
// short common-password screen. Enough to stop "password" and "12345678"
// without the frustration of aggressive complexity rules (which research shows
// push users toward predictable patterns). Length is the strongest single
// factor, so it does most of the work here.

const MIN_LENGTH = 10

// A small screen of the most-guessed passwords. Not exhaustive by design — the
// length and composition rules already exclude most weak inputs; this just
// catches long-but-obvious ones like "password123".
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'welcome1', 'welcome123',
  'qwertyuiop', 'qwerty123', '1234567890', 'iloveyou1', 'admin12345',
  'letmein123', 'changeme123', 'mosaic1234',
])

export interface PasswordCheck { ok: boolean; error?: string }

export function validatePassword(pw: string, opts?: { name?: string; email?: string }): PasswordCheck {
  const p = (pw ?? '')
  if (p.length < MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_LENGTH} characters.` }
  }
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) {
    return { ok: false, error: 'Password must include at least one letter and one number.' }
  }
  if (COMMON.has(p.toLowerCase())) {
    return { ok: false, error: 'That password is too common. Choose something less guessable.' }
  }
  // Don't let the password be the user's own name or the local part of their
  // email — trivially guessable for anyone who knows them. Check each name
  // token separately (and a spaceless join), since passwords rarely contain
  // spaces, so a full "first last" match would almost never fire.
  const lc = p.toLowerCase()
  const nameTokens = (opts?.name?.toLowerCase().trim() || '')
    .split(/\s+/).filter(t => t.length >= 4)
  const nameJoined = (opts?.name?.toLowerCase() || '').replace(/\s+/g, '')
  const local = opts?.email?.toLowerCase().split('@')[0]
  if (nameTokens.some(t => lc.includes(t)) || (nameJoined.length >= 4 && lc.includes(nameJoined))) {
    return { ok: false, error: "Password shouldn't contain your name." }
  }
  if (local && local.length >= 4 && lc.includes(local)) {
    return { ok: false, error: "Password shouldn't contain your email address." }
  }
  return { ok: true }
}

export const PASSWORD_REQUIREMENT_TEXT =
  `At least ${MIN_LENGTH} characters, including a letter and a number.`
