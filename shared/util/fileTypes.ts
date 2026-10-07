import type { ModelKind } from '../types/domain'

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
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

function normalizedMime(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase()
}

/**
 * 为 input_file 选择上游可接受的 MIME。
 * 浏览器经常把 .log 等文本文件报告为 application/octet-stream，因此优先相信已知扩展名。
 */
export function fileInputMime(filename: string, reportedMime: string): string | null {
  const extension = fileExtension(filename)
  const inferred = FILE_INPUT_MIME_BY_EXTENSION[extension]
  if (inferred) return inferred
  if (TEXT_FILE_INPUT_EXTENSIONS.has(extension)) return 'text/plain'

  const mime = normalizedMime(reportedMime)
  return SUPPORTED_EXTENSIONLESS_FILE_MIMES.has(mime) ? mime : null
}

/** 上传落盘前统一 MIME；返回 null 表示不是本站支持的图片或 OpenAI 文件输入类型。 */
export function uploadMime(filename: string, reportedMime: string): string | null {
  const imageMime = IMAGE_MIME_BY_EXTENSION[fileExtension(filename)]
  if (imageMime) return imageMime

  const mime = normalizedMime(reportedMime)
  if (IMAGE_MIMES.has(mime)) return mime
  return fileInputMime(filename, mime)
}

function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot).toLowerCase() : ''
}

/** Messages 的 document block 只接受 PDF 或纯文本；Office 文件须先转换。 */
export function isSupportedFileInputMime(mime: string | null, modelKind?: ModelKind): boolean {
  return (
    mime !== null &&
    (modelKind !== 'anthropic' ||
      mime === 'application/pdf' ||
      (mime.startsWith('text/') && mime !== 'text/rtf'))
  )
}

export const IMAGE_UPLOAD_ACCEPT = [...Object.keys(IMAGE_MIME_BY_EXTENSION), ...IMAGE_MIMES].join(
  ',',
)

/** 选择器只是筛选提示；拖拽、粘贴及「所有文件」仍需在上传前校验。 */
export function fileUploadAccept(modelKind?: ModelKind): string {
  return [
    ...Object.keys(FILE_INPUT_MIME_BY_EXTENSION).filter((extension) =>
      isSupportedFileInputMime(FILE_INPUT_MIME_BY_EXTENSION[extension]!, modelKind),
    ),
    ...TEXT_FILE_INPUT_EXTENSIONS,
    ...[...SUPPORTED_EXTENSIONLESS_FILE_MIMES].filter((mime) =>
      isSupportedFileInputMime(mime, modelKind),
    ),
  ].join(',')
}
