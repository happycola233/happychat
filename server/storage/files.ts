import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { env } from '../env'

const uploadsDir = join(env.DATA_DIR, 'uploads')

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024
export const MAX_FILE_BYTES = 64 * 1024 * 1024

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime)
}

function ensureDir() {
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true })
}

function extFromName(name: string, mime: string): string {
  const e = extname(name)
  if (e) return e
  if (mime === 'image/png') return '.png'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/gif') return '.gif'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'application/pdf') return '.pdf'
  return ''
}

export function saveUpload(id: string, originalName: string, mime: string, buf: Buffer): string {
  ensureDir()
  const full = join(uploadsDir, `${id}${extFromName(originalName, mime)}`)
  writeFileSync(full, buf)
  return full
}

export function readUpload(storagePath: string): Buffer {
  return readFileSync(storagePath)
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** 把本地文件读成 data URL（请求构建时用于内联给上游）。 */
export function toDataUrl(storagePath: string, mime: string): string {
  const b64 = readFileSync(storagePath).toString('base64')
  return `data:${mime};base64,${b64}`
}
