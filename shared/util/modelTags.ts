import type { ModelTag, StoredModelTag } from '../types/domain'

export const MODEL_TAG_MAX_COUNT = 8
export const MODEL_TAG_MAX_LABEL_LENGTH = 16
export const MODEL_TAG_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/**
 * 把历史 string[] 与当前对象数组统一为安全的 ModelTag[]。
 * 数据库中的异常颜色回退为自动配色，避免未经校验的值进入内联 CSS 变量。
 */
export function normalizeModelTags(value: unknown): ModelTag[] {
  if (!Array.isArray(value)) return []

  const normalized: ModelTag[] = []
  const seenLabels = new Set<string>()

  for (const rawTag of value as StoredModelTag[]) {
    const label = typeof rawTag === 'string' ? rawTag.trim() : rawTag?.label?.trim()
    if (
      !label ||
      label.length > MODEL_TAG_MAX_LABEL_LENGTH ||
      seenLabels.has(label) ||
      normalized.length >= MODEL_TAG_MAX_COUNT
    ) {
      continue
    }

    const rawColor = typeof rawTag === 'string' ? null : rawTag?.color
    const color =
      typeof rawColor === 'string' && MODEL_TAG_COLOR_PATTERN.test(rawColor)
        ? rawColor.toLowerCase()
        : null

    normalized.push({ label, color })
    seenLabels.add(label)
  }

  return normalized
}
