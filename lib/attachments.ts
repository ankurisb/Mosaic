// Attachment ingestion for chat.
//
// Turns uploaded files into Anthropic content blocks for the user message:
//   - images  -> native image blocks (Claude's vision handles them directly;
//                no conversion, no fidelity loss)
//   - PDF / XLSX / CSV / JSON / XML -> extracted to TEXT server-side and inlined
//                as a text block. This is far more token-efficient than sending
//                document bytes, and it's the only way these formats reach the
//                model at all.
//   - plain text -> decoded and inlined.
//
// Document extraction reuses the proven parseFileContent() path already used by
// the read_file_server tool (pdf-parse / xlsx / etc.), so we don't duplicate or
// re-test extraction logic.

import type Anthropic from '@anthropic-ai/sdk'
import { extractFileText } from '@/lib/tools'

export interface IncomingAttachment {
  name: string
  type: string   // MIME type from the browser
  data: string   // base64 (no data: prefix)
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const MAX_DOC_CHARS = 12000  // cap extracted text per document to bound tokens

function extFromName(name: string): string {
  return (name.split('.').pop() || '').toLowerCase()
}

/**
 * Build the user-message content from the typed text plus any attachments.
 * Returns a plain string when there are no attachments (cheapest, unchanged
 * behaviour) or a content-block array when there are.
 */
export async function buildUserContent(
  text: string,
  attachments: IncomingAttachment[] | undefined,
): Promise<string | Anthropic.ContentBlockParam[]> {
  if (!attachments || attachments.length === 0) return text

  const blocks: Anthropic.ContentBlockParam[] = []
  if (text && text.trim()) blocks.push({ type: 'text', text })

  for (const att of attachments) {
    const mime = (att.type || '').toLowerCase()
    const ext = extFromName(att.name)

    // -- Images: native vision, sent as-is --
    if (IMAGE_TYPES.has(mime) || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      const media = (IMAGE_TYPES.has(mime) ? mime : (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)) as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
      blocks.push({ type: 'image', source: { type: 'base64', media_type: media, data: att.data } })
      continue
    }

    // -- Documents / text: extract to text server-side --
    try {
      const buf = Buffer.from(att.data, 'base64')
      const extracted = await extractFileText(buf, att.name, MAX_DOC_CHARS)
      const label = `[Attached file: ${att.name}]`
      if (extracted && extracted.trim()) {
        blocks.push({ type: 'text', text: `${label}\n${extracted}` })
      } else {
        blocks.push({ type: 'text', text: `${label}\n(No extractable text — the file may be empty, image-only, or an unsupported format.)` })
      }
    } catch (e) {
      blocks.push({ type: 'text', text: `[Attached file: ${att.name}] could not be read: ${(e as Error).message}` })
    }
  }

  return blocks
}
