import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getSession } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || 'instances'

  if (type === 'templates') {
    const rows = await sql`SELECT * FROM report_templates ORDER BY created_at DESC`
    return Response.json({ templates: rows })
  }

  if (type === 'history') {
    const rows = await sql`
      SELECT i.*,
        t.name as template_name,
        u.name as triggered_by_name,
        (SELECT COUNT(*) FROM report_deliveries d WHERE d.report_id = i.id) as delivery_count,
        (SELECT COUNT(*) FROM report_deliveries d WHERE d.report_id = i.id AND d.status = 'sent') as sent_count
      FROM report_instances i
      LEFT JOIN report_templates t ON t.id = i.template_id
      LEFT JOIN users u ON u.id = i.triggered_by
      ORDER BY i.created_at DESC LIMIT 100`
    return Response.json({ history: rows })
  }

  const rows = await sql`
    SELECT i.*, t.name as template_name, u.name as triggered_by_name
    FROM report_instances i
    LEFT JOIN report_templates t ON t.id = i.template_id
    LEFT JOIN users u ON u.id = i.triggered_by
    WHERE i.status = 'completed'
    ORDER BY i.created_at DESC LIMIT 100`
  return Response.json({ instances: rows })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin required' }, { status: 403 })
  const sql = getDb()
  const body = await req.json()

  if (body.action === 'create_template') {
    const { name, description, type, sections, schedule, recipients } = body
    const [row] = await sql`
      INSERT INTO report_templates (name, description, type, sections, schedule, recipients, created_by)
      VALUES (${name}, ${description||''}, ${type||'operational'}, ${JSON.stringify(sections||[])}, ${schedule||null}, ${JSON.stringify(recipients||[])}, ${session.id})
      RETURNING *`
    return Response.json({ ok: true, template: row })
  }

  if (body.action === 'delete_template') {
    await sql`DELETE FROM report_templates WHERE id = ${body.id}`
    return Response.json({ ok: true })
  }

  if (body.action === 'toggle_template') {
    await sql`UPDATE report_templates SET active = ${body.active ? 1 : 0} WHERE id = ${body.id}`
    return Response.json({ ok: true })
  }

  if (body.action === 'record_instance') {
    const { name, type, trigger, conversation_id, template_id, status, pdf_path, pdf_size, error } = body
    const [row] = await sql`
      INSERT INTO report_instances (name, type, trigger, conversation_id, template_id, triggered_by, status, pdf_path, pdf_size, error, generated_at)
      VALUES (${name}, ${type||'rca'}, ${trigger||'manual'}, ${conversation_id||null}, ${template_id||null}, ${session.id}, ${status||'completed'}, ${pdf_path||null}, ${pdf_size||null}, ${error||null}, datetime('now'))
      RETURNING *`
    return Response.json({ ok: true, instance: row })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
