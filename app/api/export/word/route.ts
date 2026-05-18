import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { NextRequest } from 'next/server'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const { conversation_id, chart_images = [] } = await req.json()
  if (!conversation_id) return Response.json({ error: 'Missing conversation_id' }, { status: 400 })

  const sql = getDb()
  const convRows = await sql`SELECT * FROM conversations WHERE id = ${conversation_id} AND user_id = ${session.id}`
  if (!convRows.length) return Response.json({ error: 'Not found' }, { status: 404 })
  const conv = convRows[0] as Record<string, unknown>

  const msgRows = await sql`
    SELECT role, content, rca_block, created_at FROM messages
    WHERE conversation_id = ${conversation_id}
    ORDER BY created_at ASC`

  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    ImageRun, HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType
  } = await import('docx')

  const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const children: unknown[] = []

  // Title
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: String(conv.title || 'RCA Report'), bold: true, size: 36, font: 'Arial' })]
  }))
  children.push(new Paragraph({
    children: [new TextRun({ text: `Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}  |  Mosaic AI-assisted RCA`, color: '666666', size: 20, font: 'Arial' })]
  }))
  children.push(new Paragraph({ children: [new TextRun('')] }))

  let chartImageIndex = 0

  for (const row of msgRows) {
    const msg = row as Record<string, unknown>
    if (msg.role === 'user') {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: String(msg.content || ''), bold: true, size: 26, font: 'Arial', color: '1E3A5F' })]
      }))
    } else if (msg.role === 'assistant') {
      // Strip <end_analysis> and everything after
      const rawContent = String(msg.content || '')
      const cleanContent = rawContent.split('<end_analysis>')[0].trim()
      
      const lines = cleanContent.split('\n').filter(Boolean)
      for (const line of lines) {
        const isBold = line.startsWith('**') && line.includes('**')
        const cleanLine = line.replace(/\*\*/g, '').trim()
        if (!cleanLine) continue
        children.push(new Paragraph({
          children: [new TextRun({ text: cleanLine, size: 22, font: 'Arial', bold: isBold })],
          spacing: { after: 80 }
        }))
      }

      // Insert chart images for this assistant message's RCA block
      if (msg.rca_block) {
        try {
          const rca = typeof msg.rca_block === 'string' ? JSON.parse(msg.rca_block) : msg.rca_block
          const rendererCount = (rca.renderers || []).length

          for (let ri = 0; ri < rendererCount; ri++) {
            const renderer = rca.renderers[ri]
            
            // Insert chart image if available
            if (chartImageIndex < chart_images.length) {
              const imgData = chart_images[chartImageIndex]
              if (imgData && imgData.startsWith('data:image/png;base64,')) {
                const base64 = imgData.replace('data:image/png;base64,', '')
                const imgBuffer = Buffer.from(base64, 'base64')
                children.push(new Paragraph({ children: [new TextRun('')] }))
                children.push(new Paragraph({
                  children: [new ImageRun({
                    data: imgBuffer,
                    transformation: { width: 600, height: 300 },
                    type: 'png'
                  })]
                }))
              }
              chartImageIndex++
            }

            // Also render CAP as a table for searchability
            if (renderer.type === 'cap' && renderer.data?.actions?.length) {
              children.push(new Paragraph({ children: [new TextRun('')] }))
              if (renderer.insight) {
                children.push(new Paragraph({
                  children: [new TextRun({ text: renderer.insight, italics: true, size: 20, font: 'Arial', color: '555555' })],
                  spacing: { after: 120 }
                }))
              }
              const headerRow = new TableRow({
                children: ['#', 'Action', 'Owner', 'Due', 'Priority'].map((h, ci) =>
                  new TableCell({
                    borders, width: { size: [540,3600,1620,1620,1980][ci], type: WidthType.DXA },
                    shading: { fill: '1E3A5F', type: ShadingType.CLEAR },
                    margins: { top: 80, bottom: 80, left: 120, right: 120 },
                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18, font: 'Arial', color: 'FFFFFF' })] })]
                  })
                )
              })
              const dataRows = renderer.data.actions.map((a: Record<string, unknown>) =>
                new TableRow({
                  children: [String(a.n||''), String(a.action||''), String(a.owner||''), String(a.due||''), String(a.priority||'')].map((v, ci) =>
                    new TableCell({
                      borders, width: { size: [540,3600,1620,1620,1980][ci], type: WidthType.DXA },
                      margins: { top: 80, bottom: 80, left: 120, right: 120 },
                      children: [new Paragraph({ children: [new TextRun({ text: v, size: 18, font: 'Arial' })] })]
                    })
                  )
                })
              )
              children.push(new Table({
                width: { size: 9360, type: WidthType.DXA },
                columnWidths: [540, 3600, 1620, 1620, 1980],
                rows: [headerRow, ...dataRows]
              }))
            }
          }
        } catch { /* skip malformed rca */ }
      }
      children.push(new Paragraph({ children: [new TextRun('')] }))
    }
  }

  children.push(new Paragraph({
    children: [new TextRun({ text: 'Generated by Mosaic · AI-assisted RCA', size: 16, color: '999999', font: 'Arial', italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 480 }
  }))

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, font: 'Arial' },
          paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, font: 'Arial' },
          paragraph: { spacing: { before: 180, after: 120 }, outlineLevel: 1 } },
      ]
    },
    sections: [{
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      children: children as any
    }]
  })

  const buffer = await Packer.toBuffer(doc)
  const filename = `RCA_${String(conv.title || 'Report').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.docx`

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    }
  })
}
