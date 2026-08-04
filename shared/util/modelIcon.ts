import type { ModelIcon, ModelIconAsset } from '../types/domain'

/**
 * lobe 内置图标 slug 的字符白名单。
 *
 * slug 会被直接拼进 `/api/model-icons/lobe/<slug>` 与 CSS `mask-image: url(...)`，
 * 因此必须像 modelTags 处理自定义颜色那样做严格字符集限制——不允许点号（挡住 `..` 穿越）、
 * 斜杠、大写与任何标点，从源头上排除路径穿越与 CSS/URL 注入。
 */
export const LOBE_ICON_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/** 自定义图标 id 为 UUIDv7（`newId()`），同样只允许十六进制与连字符。 */
export const CUSTOM_ICON_ID_PATTERN = /^[0-9a-f-]{8,64}$/

/** 自定义图标名称长度上限（管理端图标库里用于辨识）。 */
export const CUSTOM_ICON_NAME_MAX_LENGTH = 40

/** 自定义图标文件大小上限：图标是小图，1MB 足够且能挡住误传的大图。 */
export const MAX_CUSTOM_ICON_BYTES = 1024 * 1024

/** Emoji 图标与聊天文件夹同规则：恰好一个字素簇（放行 ZWJ 组合与单个汉字）。 */
function isSingleGrapheme(value: string): boolean {
  if (value.length === 0 || value.length > 20) return false
  return [...new Intl.Segmenter().segment(value)].length === 1
}

/**
 * 把 JSON 列里读到的任意值归一化为合法图标。
 *
 * 契约与 `normalizeModelTags` 完全一致：入参 `unknown`、绝不抛错、非法输入静默降级为 null。
 * 数据库里可能存着旧版本或被手工改坏的值，渲染层拿到的必须已经是可安全拼进 URL 的形态。
 */
export function normalizeModelIconAsset(value: unknown): ModelIconAsset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const icon = value as Partial<ModelIconAsset> & { type?: unknown }
  switch (icon.type) {
    case 'lobe': {
      const slug = typeof icon.slug === 'string' ? icon.slug.trim().toLowerCase() : ''
      return LOBE_ICON_SLUG_PATTERN.test(slug) ? { type: 'lobe', slug } : null
    }
    case 'custom': {
      const id = typeof icon.id === 'string' ? icon.id.trim().toLowerCase() : ''
      return CUSTOM_ICON_ID_PATTERN.test(id) ? { type: 'custom', id } : null
    }
    case 'emoji': {
      const char = typeof icon.char === 'string' ? icon.char.trim() : ''
      return isSingleGrapheme(char) ? { type: 'emoji', char } : null
    }
    default:
      return null
  }
}

/**
 * 模型图标在三种资源图标之外允许显式首字母模式；模型分组应调用
 * `normalizeModelIconAsset`，避免脏数据把这个仅属于模型的状态带进分组。
 */
export function normalizeModelIcon(value: unknown): ModelIcon | null {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === 'initial'
  ) {
    return { type: 'initial' }
  }
  return normalizeModelIconAsset(value)
}

/** 两个图标是否等价（批量识别时用来跳过无变化项）。 */
export function sameModelIcon(left: ModelIcon | null, right: ModelIcon | null): boolean {
  if (left === null || right === null) return left === right
  if (left.type !== right.type) return false
  switch (left.type) {
    case 'lobe':
      return left.slug === (right as { slug: string }).slug
    case 'custom':
      return left.id === (right as { id: string }).id
    case 'emoji':
      return left.char === (right as { char: string }).char
    case 'initial':
      return true
  }
}
