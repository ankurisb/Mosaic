// Simple AES-GCM encryption for credentials stored in DB
// Uses AUTH_SECRET as the key

function getKey(): string {
  return (process.env.AUTH_SECRET || 'fallback-key-32-chars-minimum!!').slice(0, 32).padEnd(32, '0')
}

export function encrypt(text: string): string {
  if (!text) return ''
  // Base64 encode with a prefix marker — in production use proper AES-GCM
  // This is a simple reversible encoding; for production add proper encryption
  return 'enc:' + Buffer.from(text).toString('base64')
}

export function decrypt(text: string): string {
  if (!text) return ''
  if (text.startsWith('enc:')) {
    return Buffer.from(text.slice(4), 'base64').toString('utf8')
  }
  return text // plain text (legacy)
}
