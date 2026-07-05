import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { env } from '../env'

const uploadsDir = join(env.DATA_DIR, 'uploads')

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024
/** OpenAI File inputs 要求单个文件严格小于 50 MB。 */
export const MAX_FILE_INPUT_BYTES = 50 * 1024 * 1024
/** OpenAI File inputs 要求单次请求内的文件原始字节数合计不超过 50 MB。 */
export const MAX_FILE_INPUT_REQUEST_BYTES = 50 * 1024 * 1024
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/**
 * OpenAI input_file 接受的扩展名到规范 MIME 的映射。
 * 文本与代码统一使用官方支持的 text/plain；文件名仍会保留扩展名供上游识别格式。
 */
const FILE_INPUT_MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xla': 'application/vnd.ms-excel',
  '.xlb': 'application/vnd.ms-excel',
  '.xlc': 'application/vnd.ms-excel',
  '.xlm': 'application/vnd.ms-excel',
  '.xls': 'application/vnd.ms-excel',
  '.xlt': 'application/vnd.ms-excel',
  '.xlw': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.tsv': 'text/tsv',
  '.iif': 'text/x-iif',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.dot': 'application/msword',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.rtf': 'application/rtf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pot': 'application/vnd.ms-powerpoint',
  '.ppa': 'application/vnd.ms-powerpoint',
  '.pps': 'application/vnd.ms-powerpoint',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pwz': 'application/vnd.ms-powerpoint',
  '.wiz': 'application/vnd.ms-powerpoint',
}

const TEXT_FILE_INPUT_EXTENSIONS = new Set([
  '.asm',
  '.astro',
  '.bat',
  '.c',
  '.cc',
  '.clj',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.cxx',
  '.dart',
  '.def',
  '.dic',
  '.diff',
  '.eml',
  '.erl',
  '.ex',
  '.exs',
  '.go',
  '.graphql',
  '.groovy',
  '.h',
  '.hcl',
  '.hh',
  '.hrl',
  '.hs',
  '.htm',
  '.html',
  '.ics',
  '.ifb',
  '.in',
  '.ini',
  '.java',
  '.jl',
  '.js',
  '.json',
  '.json5',
  '.jsx',
  '.kt',
  '.ksh',
  '.kts',
  '.less',
  '.list',
  '.log',
  '.lua',
  '.markdown',
  '.md',
  '.mht',
  '.mhtml',
  '.mime',
  '.mjs',
  '.ndjson',
  '.nws',
  '.patch',
  '.php',
  '.pl',
  '.properties',
  '.proto',
  '.py',
  '.r',
  '.rb',
  '.rs',
  '.rst',
  '.s',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.srt',
  '.swift',
  '.text',
  '.tex',
  '.tf',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vcf',
  '.vtt',
  '.xml',
  '.yaml',
  '.yml',
])

const SUPPORTED_EXTENSIONLESS_FILE_MIMES = new Set([
  'application/json',
  'application/pdf',
  'application/rtf',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/msword',
  'message/rfc822',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/rtf',
  'text/tsv',
  'text/xml',
])

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime)
}

const EXT_MIME: Record<string, string> = {
  ...IMAGE_MIME_BY_EXTENSION,
  '.pdf': 'application/pdf',
}

function normalizedMime(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase()
}

/**
 * 为 input_file 选择上游可接受的 MIME。
 * 浏览器经常把 .log 等文本文件报告为 application/octet-stream，因此优先相信已知扩展名。
 */
export function fileInputMime(filename: string, reportedMime: string): string | null {
  const extension = extname(filename).toLowerCase()
  const inferred = FILE_INPUT_MIME_BY_EXTENSION[extension]
  if (inferred) return inferred
  if (TEXT_FILE_INPUT_EXTENSIONS.has(extension)) return 'text/plain'

  const mime = normalizedMime(reportedMime)
  return SUPPORTED_EXTENSIONLESS_FILE_MIMES.has(mime) ? mime : null
}

/** 上传落盘前统一 MIME；返回 null 表示不是本站支持的图片或 OpenAI 文件输入类型。 */
export function uploadMime(filename: string, reportedMime: string): string | null {
  const imageMime = IMAGE_MIME_BY_EXTENSION[extname(filename).toLowerCase()]
  if (imageMime) return imageMime

  const mime = normalizedMime(reportedMime)
  if (IMAGE_MIMES.has(mime)) return mime
  return fileInputMime(filename, mime)
}

/** 据扩展名推断 MIME（用于读盘内联返回，未知时回退 octet-stream）。 */
export function mimeFromPath(storagePath: string): string {
  return EXT_MIME[extname(storagePath).toLowerCase()] ?? 'application/octet-stream'
}

/** 删除磁盘文件，文件不存在时静默忽略。 */
export function removeUpload(storagePath: string): void {
  try {
    if (existsSync(storagePath)) {
      unlinkSync(storagePath)
      removeEmptyUploadParent(storagePath)
    }
  } catch {
    // 删除失败不应阻断主流程（如清空对话 / 更换头像）
  }
}

/** 删除文件后顺手清掉空的用户上传目录；只处理 uploads 根目录下的子目录。 */
function removeEmptyUploadParent(storagePath: string): void {
  const parent = dirname(storagePath)
  const rel = relative(resolve(uploadsDir), resolve(parent))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return
  try {
    rmdirSync(parent)
  } catch {
    // 父目录非空或已被并发清理时无需处理。
  }
}

function ensureUserUploadDir(userId: string): string {
  const dir = join(uploadsDir, userId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 数据目录在当前工作目录下时，DB 中优先保存可随项目搬迁的相对路径。 */
function toStoredPath(storagePath: string): string {
  const rel = relative(process.cwd(), resolve(storagePath))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return storagePath
  return rel
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

export function saveUpload(
  userId: string,
  id: string,
  originalName: string,
  mime: string,
  buf: Buffer,
): string {
  const userUploadDir = ensureUserUploadDir(userId)
  const full = join(userUploadDir, `${id}${extFromName(originalName, mime)}`)
  writeFileSync(full, buf)
  return toStoredPath(full)
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
