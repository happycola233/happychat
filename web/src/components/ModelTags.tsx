import { clsx } from 'clsx'

/**
 * 模型标签徽章：聊天端模型选择器与管理端模型列表共用。
 * 色调按标签文本哈希稳定分配（同一标签在任何地方颜色一致），浅/深色各一套低饱和配色。
 */
const TAG_TONES = [
  'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300',
  'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300',
  'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300',
  'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300',
  'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300',
] as const

function tagToneClass(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_TONES[hash % TAG_TONES.length]!
}

export function ModelTagBadge({ tag, className }: { tag: string; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex max-w-24 items-center truncate rounded px-1 py-px text-[10px] font-medium leading-4',
        tagToneClass(tag),
        className,
      )}
    >
      {tag}
    </span>
  )
}

/** 一组标签（模型列表行内直接可见）。 */
export function ModelTagList({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null
  return (
    <span className={clsx('inline-flex min-w-0 shrink items-center gap-1', className)}>
      {tags.map((tag) => (
        <ModelTagBadge key={tag} tag={tag} />
      ))}
    </span>
  )
}
