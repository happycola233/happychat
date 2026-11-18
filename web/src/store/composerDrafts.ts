import { create } from 'zustand'
import type { AttachmentDTO } from '@shared/types/api'
import { uploadDraftFromAttachment, type UploadDraftItem } from '../chat/uploadDraft'

/**
 * 输入框草稿，按「账号:对话」隔离（新聊天页用 `new` 占位），切换对话、刷新页面后原样恢复。
 *
 * - 内存里保存完整上传状态（含上传中 / 失败项与本地预览），上传任务随发起时的对话走，
 *   切走后仍在后台完成并落到原对话的草稿里。
 * - localStorage 只保存正文与已上传完成的附件，每条草稿单独一个键：
 *   多个标签页编辑不同对话时互不覆盖，切换到某条草稿时重新读取以拿到其他标签页的修改。
 */

const STORAGE_PREFIX = 'happychat-draft:'
const NEW_CONVERSATION_KEY = 'new'
/** 输入停顿后再写 localStorage，避免逐字序列化。 */
const SAVE_DELAY_MS = 400
/** 未随消息发送的附件服务端至少保留 24 小时；留出余量，超过后恢复草稿时不再带上附件。 */
const ATTACHMENT_MAX_AGE_MS = 20 * 60 * 60 * 1000
/** 超过 30 天未改动的草稿（含已删除对话遗留的）在启动时清理。 */
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface ComposerDraft {
  text: string
  uploads: UploadDraftItem[]
}

interface StoredDraft {
  text: string
  attachments: { attachment: AttachmentDTO; savedAt: number }[]
  updatedAt: number
}

interface ComposerDraftStore {
  byKey: Record<string, ComposerDraft>
}

export const useComposerDrafts = create<ComposerDraftStore>()(() => ({ byKey: {} }))

/** 无草稿时的稳定空列表，避免 selector 每次返回新数组触发重渲染。 */
export const EMPTY_DRAFT_UPLOADS: UploadDraftItem[] = []
const EMPTY_DRAFT: ComposerDraft = { text: '', uploads: EMPTY_DRAFT_UPLOADS }

export function composerDraftKey(userId: string, conversationId: string | undefined): string {
  return `${userId}:${conversationId ?? NEW_CONVERSATION_KEY}`
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** 写入 localStorage 失败的草稿：存储里是旧内容，读取时必须以内存为准。 */
const unsavedKeys = new Set<string>()
/** 附件首次写入草稿的时间：跨多次保存保持不变，用来判断服务端是否可能已清理该附件。 */
const attachmentSavedAt = new Map<string, number>()

// localStorage 在隐私模式或配额已满时可能抛错，内容也可能被手动改坏：读不到就当没有草稿。
function readStoredDraft(key: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredDraft>) : null
    return typeof parsed?.text === 'string' &&
      Array.isArray(parsed.attachments) &&
      typeof parsed.updatedAt === 'number'
      ? (parsed as StoredDraft)
      : null
  } catch {
    return null
  }
}

function writeStoredDraft(key: string, draft: StoredDraft | null): boolean {
  try {
    if (draft) localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(draft))
    else localStorage.removeItem(STORAGE_PREFIX + key)
    return true
  } catch {
    return false
  }
}

function saveNow(key: string) {
  clearTimeout(saveTimers.get(key))
  saveTimers.delete(key)
  const draft = useComposerDrafts.getState().byKey[key]
  const now = Date.now()
  const attachments = (draft?.uploads ?? []).flatMap((item) => {
    if (!item.attachment) return []
    const savedAt = attachmentSavedAt.get(item.attachment.id) ?? now
    attachmentSavedAt.set(item.attachment.id, savedAt)
    return [{ attachment: item.attachment, savedAt }]
  })
  const saved = writeStoredDraft(
    key,
    draft?.text || attachments.length
      ? { text: draft?.text ?? '', attachments, updatedAt: now }
      : null,
  )
  if (saved) unsavedKeys.delete(key)
  else unsavedKeys.add(key)
}

// 任何一条草稿变化（含删除）都延迟写出；上传进度等只影响内存的变化写出结果不变，代价可忽略。
useComposerDrafts.subscribe((state, previous) => {
  const keys = new Set([...Object.keys(state.byKey), ...Object.keys(previous.byKey)])
  for (const key of keys) {
    if (state.byKey[key] === previous.byKey[key]) continue
    clearTimeout(saveTimers.get(key))
    saveTimers.set(
      key,
      setTimeout(() => saveNow(key), SAVE_DELAY_MS),
    )
  }
})

/** 立即写出所有待保存的草稿（页面隐藏 / 关闭前）。 */
export function flushComposerDrafts() {
  for (const key of [...saveTimers.keys()]) saveNow(key)
}

const hasContent = (draft: ComposerDraft) => Boolean(draft.text || draft.uploads.length)

function updateDraft(key: string, update: (draft: ComposerDraft) => ComposerDraft) {
  useComposerDrafts.setState((state) => {
    const next = update(state.byKey[key] ?? EMPTY_DRAFT)
    const byKey = { ...state.byKey }
    if (hasContent(next)) byKey[key] = next
    else delete byKey[key]
    return { byKey }
  })
}

/**
 * 进入某条草稿时从 localStorage 读取最新内容（可能来自其他标签页）。
 * 本页还有未写出（或写入失败）的修改、或存储里没有这条草稿时以内存为准；
 * 本页的上传中 / 失败项与已完成项的本地预览原样保留。
 */
export function loadComposerDraft(key: string) {
  if (saveTimers.has(key) || unsavedKeys.has(key)) return
  const stored = readStoredDraft(key)
  if (!stored) return
  const now = Date.now()
  updateDraft(key, (memory) => {
    const memoryDone = new Map<string, UploadDraftItem>(
      memory.uploads.flatMap((item) =>
        item.attachment ? [[item.attachment.id, item] as const] : [],
      ),
    )
    const restored = stored.attachments.flatMap(({ attachment, savedAt }) => {
      if (now - savedAt > ATTACHMENT_MAX_AGE_MS) return []
      attachmentSavedAt.set(attachment.id, savedAt)
      return [memoryDone.get(attachment.id) ?? uploadDraftFromAttachment(attachment)]
    })
    return {
      text: stored.text,
      uploads: [...restored, ...memory.uploads.filter((item) => item.status !== 'done')],
    }
  })
}

export function setComposerDraftText(key: string, text: string) {
  updateDraft(key, (draft) => ({ ...draft, text }))
}

export function updateComposerDraftUploads(
  key: string,
  update: (uploads: UploadDraftItem[]) => UploadDraftItem[],
) {
  updateDraft(key, (draft) => ({ ...draft, uploads: update(draft.uploads) }))
}

/**
 * 发送请求失败后放回原文与附件（输入框在请求发出时已清空）。
 * 等待响应期间若已输入新内容，原文放在前面并空一行，两者都保留；
 * 用户已切到其他对话时写回原对话的草稿。
 */
export function restoreFailedComposerDraft(
  key: string,
  text: string,
  attachments: AttachmentDTO[],
) {
  if (!useComposerDrafts.getState().byKey[key]) loadComposerDraft(key)
  updateDraft(key, (draft) => ({
    text: draft.text.trim() ? `${text}\n\n${draft.text}` : text,
    uploads: [...attachments.map(uploadDraftFromAttachment), ...draft.uploads],
  }))
}

/**
 * 输入框卸载（离开聊天页）时上传任务随之中止、本地预览被释放：
 * 丢弃未完成项，已完成项改用服务端地址预览。
 */
export function releaseComposerDraftUploads() {
  useComposerDrafts.setState((state) => ({
    byKey: Object.fromEntries(
      Object.entries(state.byKey).flatMap(([key, draft]) => {
        // 无需释放的草稿保持原对象，避免订阅把它们当作修改重新写出
        if (draft.uploads.every((item) => item.status === 'done' && !item.previewUrl))
          return [[key, draft] as const]
        const released: ComposerDraft = {
          ...draft,
          uploads: draft.uploads.flatMap((item) =>
            item.status === 'done' ? [{ ...item, previewUrl: null }] : [],
          ),
        }
        return hasContent(released) ? [[key, released] as const] : []
      }),
    ),
  }))
}

function storedDraftKeys(): string[] {
  try {
    const keys: string[] = []
    for (let index = 0; index < localStorage.length; index++) {
      const name = localStorage.key(index)
      if (name?.startsWith(STORAGE_PREFIX)) keys.push(name.slice(STORAGE_PREFIX.length))
    }
    return keys
  } catch {
    return []
  }
}

/** 退出登录或注销账号时删除该账号在本浏览器中的全部草稿。 */
export function removeUserComposerDrafts(userId: string) {
  const prefix = `${userId}:`
  // 先清内存：订阅为这些键安排的延迟保存届时读到的是空草稿，写出的仍是删除。
  useComposerDrafts.setState((state) => ({
    byKey: Object.fromEntries(
      Object.entries(state.byKey).filter(([key]) => !key.startsWith(prefix)),
    ),
  }))
  for (const key of storedDraftKeys()) {
    if (key.startsWith(prefix)) writeStoredDraft(key, null)
  }
  for (const key of unsavedKeys) {
    if (key.startsWith(prefix)) unsavedKeys.delete(key)
  }
}

/** 应用启动时调用：清理过期草稿，并在页面隐藏 / 关闭前立即写出未保存的修改。 */
export function startComposerDraftPersistence() {
  const now = Date.now()
  for (const key of storedDraftKeys()) {
    const stored = readStoredDraft(key)
    if (!stored || now - stored.updatedAt > DRAFT_MAX_AGE_MS) writeStoredDraft(key, null)
  }
  window.addEventListener('pagehide', flushComposerDrafts)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushComposerDrafts()
  })
}
