// Attachment ingestion for chat.
//
// Turns uploaded files into Anthropic content blocks for the user message:
//   - images (jpeg/png/gif/webp) -> native image blocks (Claude's vision handles
//                them directly; no conversion, no fidelity loss)
//   - PDF / XLSX / CSV / JSON / XML -> extracted to TEXT server-side and inlined
//                as a text block. This is far more token-efficient than sending
//                document bytes, and it's the only way these formats reach the
//                model at all.
//   - plain text -> decoded and inlined.
//
// This is the SERVER-SIDE SAFETY NET. The browser (components/ChatPage.tsx) now
// downscales large images and transcodes HEIC→JPEG before upload, so in the
// normal path everything arriving here is already sendable. But anything can
// POST to this route, and older clients / edge cases still arrive, so we re-check
// here and — crucially — turn every unusable file into a CLEAR, visible text
// notice in the user turn instead of silently dropping it or misrouting a HEIC
// photo into the document-text extractor (which produced "no extractable text"
// and made the whole turn look like it did nothing).
//
// Document extraction reuses the proven parseFileContent() path already used by
// the read_file_server tool (pdf-parse / xlsx / etc.), so we don't duplicate or
// re-test extraction logic.

import type Anthropic from '@anthropic-ai/sdk'
import { extractFileText } from '@/lib/tools'
import {
  classifyAttachment, base64Bytes, humanBytes, imageTooLarge,
  SUPPORTED_IMAGE_MIME, extOf, MAX_IMAGE_BYTES,
} from '@/lib/attachment-limits'

export interface IncomingAttachment {
  name: string
  type: string   // MIME type from the browser
  data: string   // base64 (no data: prefix)
}

const MAX_DOC_CHARS = 12000  // cap extracted text per document to bound tokens

// Phase 7 (gated by ANTHROPIC_CITATIONS): when on, extracted document text is sent
// as a native `document` content block with citations enabled, so the model can
// cite the exact source passage. We keep our proven text extraction (cheaper and
// lower-risk than shipping raw PDF bytes) and just wrap it in a citable document.
// OFF by default → documents are inlined as plain text blocks exactly as before.
const CITATIONS_ENABLED = process.env.ANTHROPIC_CITATIONS === '1'

// A visible notice block the model will relay — never a silent drop.
function notice(name: string, reason: string): Anthropic.ContentBlockParam {
  return { type: 'text', text: `[Attached file "${name}" could not be used: ${reason}]` }
}

function imageMediaType(mime: string, ext: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (SUPPORTED_IMAGE_MIME.has(mime)) return mime as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'gif') return 'image/gif'
  return 'image/webp'
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
    const ext = extOf(att.name)
    const kind = classifyAttachment(mime, att.name)

    // -- Native images: send as-is, but guard decoded size so one oversized
    //    image cannot 400 the entire Anthropic request (which surfaced to the
    //    user as a generic error with no clue which file was at fault). --
    if (kind === 'image-native') {
      const bytes = base64Bytes(att.data)
      if (imageTooLarge(bytes)) {
        blocks.push(notice(att.name,
          `image is ${humanBytes(bytes)}, over the ${humanBytes(MAX_IMAGE_BYTES)} limit for direct analysis. ` +
          `Re-send it from an up-to-date Mosaic client (which shrinks large images automatically), or resize it below ${humanBytes(MAX_IMAGE_BYTES)}.`))
        continue
      }
      blocks.push({ type: 'image', source: { type: 'base64', media_type: imageMediaType(mime, ext), data: att.data } })
      continue
    }

    // -- HEIC/HEIF: not accepted by Claude's vision API. The current client
    //    transcodes to JPEG before upload, so reaching here means an old client
    //    or a failed transcode — say so plainly instead of pretending it's a
    //    document. --
    if (kind === 'image-heic') {
      blocks.push(notice(att.name,
        'HEIC/HEIF images are not supported for analysis. Please re-send as JPEG or PNG ' +
        '(on iPhone: Settings → Camera → Formats → "Most Compatible", or share the photo which converts it).'))
      continue
    }

    // -- Other image types we can't feed to vision (svg/tiff/bmp/…). --
    if (kind === 'image-unsupported') {
      blocks.push(notice(att.name,
        `image type "${mime || ext}" is not supported for analysis. Please convert it to JPEG or PNG and re-send.`))
      continue
    }

    // -- Documents / text / unknown: extract to text server-side -------------
    try {
      const buf = Buffer.from(att.data, 'base64')
      const extracted = await extractFileText(buf, att.name, MAX_DOC_CHARS)
      const label = `[Attached file: ${att.name}]`
      if (extracted && extracted.trim() && CITATIONS_ENABLED) {
        blocks.push({
          type: 'document',
          title: att.name,
          source: { type: 'text', media_type: 'text/plain', data: extracted },
          citations: { enabled: true },
        })
      } else if (extracted && extracted.trim()) {
        // Flag truncation so partial analysis is never a silent surprise.
        const truncated = extracted.length >= MAX_DOC_CHARS
          ? `\n[Note: this file was truncated to the first ${MAX_DOC_CHARS.toLocaleString()} characters for analysis.]`
          : ''
        blocks.push({ type: 'text', text: `${label}\n${extracted}${truncated}` })
      } else {
        blocks.push({ type: 'text', text: `${label}\n(No extractable text — the file may be empty, image-only (e.g. a scanned PDF), password-protected, or an unsupported format.)` })
      }
    } catch (e) {
      blocks.push(notice(att.name, `could not be read: ${(e as Error).message}`))
    }
  }

  return blocks
}
