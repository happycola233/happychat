import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { IMAGE_MIME_BY_EXTENSION } from '@shared/util/fileTypes'
import { env } from '../env'

const uploadsDir = join(env.DATA_DIR, 'uploads')

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

const EXT_MIME: Record<string, string> = {
  ...IMAGE_MIME_BY_EXTENSION,
  '.pdf': 'application/pdf',
}

/** 据扩展名推断 MIME（用于读盘内联返回，未知时回退 octet-stream）。 */
export function mimeFromPath(storagePath: string): string {
  return EXT_MIME[extname(storagePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 自动删除只能作用于 DATA_DIR/uploads 内的文件。即使 DB 路径被误写或污染，
 * 后台维护任务也不能越界删除项目外文件。
 */
function resolveUploadFileForRemoval(storagePath: string): string {
  const root = resolve(uploadsDir)
  const target = resolve(storagePath)
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('拒绝删除上传目录之外的文件')
  }
  return target
}

/** 发送最终认领前确认文件仍在受管上传目录中且存在。 */
export function uploadFileExists(storagePath: string): boolean {
  try {
    return statSync(resolveUploadFileForRemoval(storagePath)).isFile()
  } catch {
    return false
  }
}

/**
 * 严格删除磁盘文件：文件本就不存在视为成功，其余 unlink 错误向上抛出。
 * 后台垃圾回收需要据此保留失败的 DB 行，才能在下一轮继续重试。
 */
export function removeUploadStrict(storagePath: string): void {
  const target = resolveUploadFileForRemoval(storagePath)
  try {
    unlinkSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  removeEmptyUploadParent(target)
}

/** 删除磁盘文件，文件不存在或删除失败时静默忽略。 */
export function removeUpload(storagePath: string): void {
  try {
    removeUploadStrict(storagePath)
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

/** DB 内统一保存为跨平台的 / 分隔符。 */
function toForwardSlashPath(storagePath: string): string {
  return storagePath.replace(/\\/g, '/')
}

/** 数据目录在当前工作目录下时，DB 中优先保存可随项目搬迁的相对路径。 */
function toStoredPath(storagePath: string): string {
  const rel = relative(process.cwd(), resolve(storagePath))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return storagePath
  return toForwardSlashPath(rel)
}

function extFromName(name: string, mime: string): string {
  const e = extname(name)
  if (e) return e
  if (mime === 'image/png') return '.png'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/gif') return '.gif'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'image/svg+xml') return '.svg'
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

/**
 * 为同一用户复制一份独立附件文件。
 * 会话分支不能复用原 storagePath，否则删除任一会话都会让另一会话的附件失效。
 */
export function copyUpload(
  userId: string,
  id: string,
  originalName: string,
  mime: string,
  sourcePath: string,
): string {
  const userUploadDir = ensureUserUploadDir(userId)
  const full = join(userUploadDir, `${id}${extFromName(originalName, mime)}`)
  try {
    copyFileSync(sourcePath, full)
  } catch (error) {
    // copyFile 不是跨文件系统事务；目的端故障时主动清掉可能留下的不完整文件。
    removeUpload(full)
    throw error
  }
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
