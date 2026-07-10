import { useState } from 'react'
import { X } from 'lucide-react'
import { ModelTagBadge } from '../../components/ModelTags'

const MAX_TAGS = 8
const MAX_TAG_LENGTH = 16

/**
 * 标签芯片输入：Enter / 逗号 / 顿号 / 失焦 提交当前输入，Backspace 在空输入时删除末尾标签。
 * 与用户端展示同一套 ModelTagBadge 配色，管理员配置时即所见即所得。
 */
export function TagsInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  const commitDraft = () => {
    // 支持一次粘贴多个（逗号/顿号分隔），统一去空白、去重、限量限长。
    const candidates = draft
      .split(/[,，、]/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (candidates.length === 0) {
      setDraft('')
      return
    }
    const next = [...tags]
    for (const tag of candidates) {
      if (next.length >= MAX_TAGS) break
      if (tag.length > MAX_TAG_LENGTH || next.includes(tag)) continue
      next.push(tag)
    }
    onChange(next)
    setDraft('')
  }

  const removeTag = (tag: string) => onChange(tags.filter((t) => t !== tag))

  return (
    <div>
      <div className="flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-2.5 py-1.5 transition focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:focus-within:border-sky-400">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-0.5">
            <ModelTagBadge tag={tag} className="!max-w-none !text-xs" />
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={`删除标签 ${tag}`}
              className="flex h-4 w-4 items-center justify-center rounded text-neutral-400 transition hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === '、') {
              e.preventDefault()
              commitDraft()
            } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
              removeTag(tags[tags.length - 1]!)
            }
          }}
          onBlur={commitDraft}
          disabled={tags.length >= MAX_TAGS && draft === ''}
          placeholder={
            tags.length >= MAX_TAGS ? `最多 ${MAX_TAGS} 个标签` : (placeholder ?? '输入后回车添加')
          }
          className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-neutral-400 dark:text-neutral-100"
        />
      </div>
      <p className="mt-1 text-xs leading-5 text-neutral-400">
        直接展示在用户的模型列表里（如「内测」「禁止滥用」）；每个不超过 {MAX_TAG_LENGTH} 字，最多{' '}
        {MAX_TAGS} 个。
      </p>
    </div>
  )
}
