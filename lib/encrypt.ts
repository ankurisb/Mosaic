import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET || 'fallback-key-32-chars-minimum!!'
  // Derive a 32-byte key from AUTH_SECRET
  return Buffer.from(secret.slice(0, 32).padEnd(32, '0'))
}

export function encrypt(text: string): string {
  if (!text) return ''
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: enc2:<iv_hex>:<tag_hex>:<data_hex>
  return 'enc2:' + iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex')
}

export function decrypt(text: string): string {
  if (!text) return ''
  // New AES-GCM format
  if (text.startsWith('enc2:')) {
    const parts = text.slice(5).split(':')
    if (parts.length !== 3) return ''
    const [ivHex, tagHex, dataHex] = parts
    const key = getKey()
    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const data = Buffer.from(dataHex, 'hex')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  }
  // Legacy Base64 format -- keep reading old records
  if (text.startsWith('enc:')) {
    return Buffer.from(text.slice(4), 'base64').toString('utf8')
  }
  return text
}
