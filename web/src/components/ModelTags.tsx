import type { CSSProperties } from 'react'
import { clsx } from 'clsx'
import type { ModelTag } from '@shared/types/domain'
import { MODEL_TAG_TONE_COLORS } from './colorPresets'

/**
 * 模型标签徽章：聊天端模型选择器与管理端模型列表共用。
 * 色调按标签文本哈希稳定分配（同一标签在任何地方颜色一致），浅/深色各一套低饱和配色。
 */
const TAG_TONES = [
  {
    color: MODEL_TAG_TONE_COLORS.sky,
    className: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300',
  },
  {
    color: MODEL_TAG_TONE_COLORS.violet,
    className: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300',
  },
  {
    color: MODEL_TAG_TONE_COLORS.amber,
    className: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300',
  },
  {
    color: MODEL_TAG_TONE_COLORS.emerald,
    className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300',
  },
  {
    color: MODEL_TAG_TONE_COLORS.rose,
    className: 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300',
  },
] as const

function tagToneForLabel(label: string): (typeof TAG_TONES)[number] {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return TAG_TONES[hash % TAG_TONES.length]!
}

function tagToneForPreset(color: string): (typeof TAG_TONES)[number] | undefined {
  const normalizedColor = color.toLowerCase()
  return TAG_TONES.find((tone) => tone.color === normalizedColor)
}

export function ModelTagBadge({ tag, className }: { tag: ModelTag; className?: string }) {
  const tone = tag.color === null ? tagToneForLabel(tag.label) : tagToneForPreset(tag.color)
  const usesArbitraryColor = tag.color !== null && tone === undefined
  const style = usesArbitraryColor
    ? ({ '--hc-model-tag-color': tag.color } as CSSProperties)
    : undefined

  return (
    <span
      className={clsx(
        'inline-flex max-w-24 items-center truncate rounded px-1 py-px text-[10px] font-medium leading-4',
        tone?.className ?? 'hc-model-tag-custom',
        className,
      )}
      style={style}
    >
      {tag.label}
    </span>
  )
}

/** 一组标签（模型列表行内直接可见）。 */
export function ModelTagList({ tags, className }: { tags: ModelTag[]; className?: string }) {
  if (tags.length === 0) return null
  return (
    <span className={clsx('inline-flex min-w-0 shrink items-center gap-1', className)}>
      {tags.map((tag) => (
        <ModelTagBadge key={tag.label} tag={tag} />
      ))}
    </span>
  )
}
