import { describe, it, expect } from 'vitest'
import {
  classifyAttachment, base64Bytes, imageTooLarge, extOf, humanBytes,
  MAX_IMAGE_BYTES,
} from './attachment-limits'

describe('classifyAttachment', () => {
  it('recognises vision-native images by MIME', () => {
    expect(classifyAttachment('image/jpeg', 'a.jpg')).toBe('image-native')
    expect(classifyAttachment('image/png', 'a.png')).toBe('image-native')
    expect(classifyAttachment('image/webp', 'a.webp')).toBe('image-native')
    expect(classifyAttachment('image/gif', 'a.gif')).toBe('image-native')
  })

  it('recognises native images by extension when MIME is blank', () => {
    expect(classifyAttachment('', 'photo.PNG')).toBe('image-native')
    expect(classifyAttachment('application/octet-stream', 'shot.jpeg')).toBe('image-native')
  })

  it('flags HEIC/HEIF (the iPhone default) distinctly so it is transcoded, not misrouted', () => {
    expect(classifyAttachment('image/heic', 'IMG_0001.HEIC')).toBe('image-heic')
    expect(classifyAttachment('image/heif', 'x.heif')).toBe('image-heic')
    // Common case: browser sends no MIME for HEIC, only the extension.
    expect(classifyAttachment('', 'IMG_0001.heic')).toBe('image-heic')
  })

  it('flags other image types we cannot feed to vision', () => {
    expect(classifyAttachment('image/svg+xml', 'logo.svg')).toBe('image-unsupported')
    expect(classifyAttachment('image/tiff', 'scan.tiff')).toBe('image-unsupported')
    expect(classifyAttachment('image/bmp', 'old.bmp')).toBe('image-unsupported')
  })

  it('routes documents and text to extraction', () => {
    expect(classifyAttachment('application/pdf', 'r.pdf')).toBe('document')
    expect(classifyAttachment('', 'data.csv')).toBe('document')
    expect(classifyAttachment('', 'book.xlsx')).toBe('document')
    expect(classifyAttachment('text/plain', 'notes.txt')).toBe('document')
    expect(classifyAttachment('application/json', 'cfg.json')).toBe('document')
  })

  it('falls back to unknown for untyped, unknown-extension files', () => {
    expect(classifyAttachment('', 'mysteryfile')).toBe('unknown')
    expect(classifyAttachment('application/octet-stream', 'blob.bin')).toBe('unknown')
  })
})

describe('base64Bytes', () => {
  it('computes decoded length accounting for padding', () => {
    // "hello" -> aGVsbG8= (8 chars, 1 pad) -> 5 bytes
    expect(base64Bytes('aGVsbG8=')).toBe(5)
    // "hi" -> aGk= (4 chars, 1 pad) -> 2 bytes
    expect(base64Bytes('aGk=')).toBe(2)
    // "foo" -> Zm9v (4 chars, 0 pad) -> 3 bytes
    expect(base64Bytes('Zm9v')).toBe(3)
    expect(base64Bytes('')).toBe(0)
  })
})

describe('imageTooLarge', () => {
  it('is false at the limit and true above it', () => {
    expect(imageTooLarge(MAX_IMAGE_BYTES)).toBe(false)
    expect(imageTooLarge(MAX_IMAGE_BYTES + 1)).toBe(true)
    expect(imageTooLarge(1024)).toBe(false)
  })
})

describe('extOf', () => {
  it('lowercases and takes the last segment', () => {
    expect(extOf('A.Final.PNG')).toBe('png')
    expect(extOf('noext')).toBe('noext') // no dot → whole string; callers treat via classify
    expect(extOf('archive.tar.gz')).toBe('gz')
  })
})

describe('humanBytes', () => {
  it('formats B / KB / MB', () => {
    expect(humanBytes(512)).toBe('512 B')
    expect(humanBytes(2048)).toBe('2 KB')
    expect(humanBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
