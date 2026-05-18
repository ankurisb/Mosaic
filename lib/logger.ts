// lib/logger.ts
// Singleton Pino logger with dual output:
//   - stdout (always) — for Docker log drivers and terminal
//   - logs/server.log (always) — for the in-app log viewer in System Health
//
// Usage:
//   import { log } from '@/lib/logger'
//   log.info({ service: 'chat', userId }, 'Request completed')
//   log.error({ service: 'db', err }, 'Query failed')
//
// In API routes, create a per-request child logger:
//   const reqLog = log.child({ requestId, userId, service: 'chat' })

import pino from 'pino'
import { join } from 'path'

const isDev = process.env.NODE_ENV !== 'production'
const LOG_FILE = join(process.cwd(), 'logs', 'server.log')

function buildLogger() {
  if (isDev) {
    // Dev: pretty-print to stdout only
    return pino({
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          messageFormat: '[{service}] {msg}',
        },
      },
      base: { env: 'development', version: process.env.npm_package_version || 'unknown' },
    })
  }

  // Production: write NDJSON to both stdout and logs/server.log
  return pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      base: {
        env: process.env.NODE_ENV || 'production',
        version: process.env.npm_package_version || 'unknown',
      },
    },
    pino.multistream([
      { stream: process.stdout },
      {
        stream: pino.destination({
          dest: LOG_FILE,
          sync: false,
          append: true,
          mkdir: true,
        }),
      },
    ])
  )
}

export const log = buildLogger()

// Helper: create a per-request child logger
export function reqLogger(opts: {
  requestId?: string
  userId?: string
  userEmail?: string
  service: string
}) {
  return log.child(opts)
}

// Helper: short request ID when none provided by proxy
export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10)
}
