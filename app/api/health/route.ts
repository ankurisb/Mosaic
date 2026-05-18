import { APP_VERSION } from '@/lib/version'
export const runtime = 'nodejs'
export async function GET() {
  return Response.json({ status: 'ok', version: APP_VERSION, ts: new Date().toISOString() })
}
