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

// Per-document extraction cap. 12k chars (~3k tokens) was far too small for real
// API specs — a SAP OData $metadata or an OpenAPI doc is routinely tens to a few
// hundred KB, and cutting it to 12k meant the model only ever saw the first few
// entities ("Only what was visible in the first 12,000 characters"). We raise it
// to a generous ceiling so a full spec goes through intact, and bound the whole
// turn with an aggregate cap below so several large files still can't blow the
// context window. Both are env-tunable for smaller-context deployments.
const MAX_DOC_CHARS = Math.max(1000, Number(process.env.CHAT_ATTACHMENT_MAX_CHARS) || 200_000)
// Total extracted-text budget across ALL attachments in one turn (~125k tokens by
// default, leaving ample room in a 200k window for history, system prompt and the
// reply). Each document draws from what's left, so N huge files degrade gracefully
// instead of overflowing.
const MAX_TOTAL_DOC_CHARS = Math.max(MAX_DOC_CHARS, Number(process.env.CHAT_ATTACHMENTS_TOTAL_CHARS) || 500_000)

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

  // Remaining shared text budget for this turn; each document takes min(per-doc,
  // what's left) so a few very large files can't overflow the context window.
  let remainingDocBudget = MAX_TOTAL_DOC_CHARS

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
      // Draw this document's cap from the remaining shared budget.
      const perDocCap = Math.max(0, Math.min(MAX_DOC_CHARS, remainingDocBudget))
      const extracted = perDocCap > 0 ? await extractFileText(buf, att.name, perDocCap) : ''
      remainingDocBudget -= extracted.length
      const label = `[Attached file: ${att.name}]`
      if (perDocCap === 0) {
        // Earlier attachments already consumed the whole turn budget.
        blocks.push({ type: 'text', text: `${label}\n[Not analysed: the combined size of the attached files exceeds the per-message limit. Send this file in a separate message.]` })
      } else if (extracted && extracted.trim() && CITATIONS_ENABLED) {
        blocks.push({
          type: 'document',
          title: att.name,
          source: { type: 'text', media_type: 'text/plain', data: extracted },
          citations: { enabled: true },
        })
      } else if (extracted && extracted.trim()) {
        // Flag truncation so partial analysis is never a silent surprise. With the
        // raised cap this only fires on genuinely huge files.
        const truncated = extracted.length >= perDocCap
          ? `\n[Note: this file was large and only the first ${perDocCap.toLocaleString()} characters were included. Ask about a specific section, or split the file, to see more.]`
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
