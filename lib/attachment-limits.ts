// Shared attachment ingest limits + classification.
//
// Single source of truth for both the browser (components/ChatPage.tsx, which
// downscales/converts before upload) and the server (lib/attachments.ts, which
// is the safety net). Pure and isomorphic: NO DOM, NO Node-only APIs, so it can
// be imported from a client component and a route handler alike.
//
// Why this exists: uploaded media used to fail in ways that looked like a
// "network error" or a silent drop — chiefly (a) HEIC photos (iPhone default)
// which neither our old whitelist nor Claude's vision API accept, (b) full-res
// images that blow Anthropic's per-image size limit and 400 the whole request,
// and (c) many multi-MB images base64-inlined into one JSON body that stalls or
// resets. These limits + the classifier below let both ends agree on exactly
// what is sendable, what must be shrunk, and what must be rejected with a clear,
// visible reason instead of vanishing.

// Anthropic vision accepts these natively. Everything else that is "an image"
// must be converted (HEIC) or rejected.
export const SUPPORTED_IMAGE_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
])
export const SUPPORTED_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])

// HEIC/HEIF — iPhone/iPad default. Not accepted by Claude's vision API; the
// client tries to transcode to JPEG (works on iOS/Safari via canvas), and if
// that fails the file is rejected with a clear message rather than silently
// routed into the document-text extractor (where it produced "no extractable
// text" and the turn appeared to do nothing).
export const HEIC_MIME = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'])
export const HEIC_EXT = new Set(['heic', 'heif'])

// Document/text formats we extract to text server-side (parseFileContent path).
export const DOC_EXT = new Set(['pdf', 'csv', 'tsv', 'xlsx', 'xls', 'json', 'xml', 'txt', 'md', 'log', 'docx', 'pptx'])

// Hard ceilings.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024        // Anthropic per-image cap (decoded)
export const MAX_IMAGE_EDGE = 1568                    // Anthropic's recommended max long edge (px)
export const TARGET_IMAGE_JPEG_QUALITY = 0.85         // re-encode quality when downscaling photos
export const MAX_DOC_BYTES = 25 * 1024 * 1024         // reject documents larger than this
export const MAX_ATTACH_COUNT = 20                    // per-turn attachment count cap
export const MAX_TOTAL_UPLOAD_BYTES = 40 * 1024 * 1024 // combined per-turn payload cap

export type AttachmentKind =
  | 'image-native'       // jpeg/png/gif/webp — send as-is (after optional downscale)
  | 'image-heic'         // heic/heif — must transcode client-side or be rejected
  | 'image-unsupported'  // some other image/* we can't use (e.g. svg, tiff, bmp)
  | 'document'           // extract to text server-side
  | 'unknown'            // no reliable type — let the server attempt doc extraction

export function extOf(name: string): string {
  return (name.split('.').pop() || '').toLowerCase()
}

/**
 * Classify an attachment from its (browser-provided) MIME type and filename.
 * MIME is preferred; extension is the fallback when the browser gives a blank
 * or generic type (common for HEIC and for files dragged from some apps).
 */
export function classifyAttachment(mime: string | undefined, name: string): AttachmentKind {
  const m = (mime || '').toLowerCase()
  const ext = extOf(name)

  if (SUPPORTED_IMAGE_MIME.has(m) || SUPPORTED_IMAGE_EXT.has(ext)) return 'image-native'
  if (HEIC_MIME.has(m) || HEIC_EXT.has(ext)) return 'image-heic'
  if (m.startsWith('image/')) return 'image-unsupported'
  if (DOC_EXT.has(ext)) return 'document'
  // Some browsers send text/* or application/* for docs without a known ext.
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/pdf') return 'document'
  return 'unknown'
}

/** Decoded byte length of a base64 string (no data: prefix), without allocating. */
export function base64Bytes(b64: string): number {
  if (!b64) return 0
  const len = b64.length
  let padding = 0
  if (b64.endsWith('==')) padding = 2
  else if (b64.endsWith('=')) padding = 1
  return Math.floor((len * 3) / 4) - padding
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Server-side admissibility check for an already-classified image, by decoded
 * size. Dimension is enforced on the client (needs a decoder); the server can
 * only cheaply see bytes, so bytes is the backstop that prevents an oversized
 * image from 400-ing the whole Anthropic request.
 */
export function imageTooLarge(bytes: number): boolean {
  return bytes > MAX_IMAGE_BYTES
}
