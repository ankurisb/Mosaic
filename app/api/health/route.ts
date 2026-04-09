export const runtime = 'nodejs'
export async function GET() {
  return Response.json({ status: 'ok', version: '1.0.0', ts: new Date().toISOString() })
}
