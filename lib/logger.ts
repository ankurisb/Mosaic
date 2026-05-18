// lib/logger.ts
// Singleton Pino logger for structured JSON logging throughout Mosaic.
// Usage:
//   import { log } from '@/lib/logger'
//   log.info({ userId, latency_ms }, 'Chat request completed')
//   log.error({ err, requestId }, 'Tool call failed')
//
// In API routes, create a child logger with request context:
//   const reqLog = log.child({ requestId, userId, service: 'chat' })
//   reqLog.info('Processing request')

import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

export const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  // In development: human-readable output via pino-pretty
  // In production: NDJSON to stdout (works with any log driver)
  ...(isDev ? {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: '[{service}] {msg}',
      },
    },
  } : {}),
  base: {
    env: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || 'unknown',
  },
})

// Helper: create a per-request child logger
// Call this at the top of each API route handler
export function reqLogger(opts: {
  requestId?: string
  userId?: string
  userEmail?: string
  service: string
}) {
  return log.child(opts)
}

// Helper: generate a short request ID when one isn't provided by a proxy
export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10)
}
