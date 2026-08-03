import { useId, useState } from 'react'
import { Check, Pipette, Sparkles, X } from 'lucide-react'
import { HexColorInput, HexColorPicker } from 'react-colorful'
import { clsx } from 'clsx'
import type { ModelTag } from '@shared/types/domain'
import { MODEL_TAG_MAX_COUNT, MODEL_TAG_MAX_LABEL_LENGTH } from '@shared/util/modelTags'
import { MODEL_TAG_COLOR_PRESETS } from '../../components/colorPresets'
import { ModelTagBadge } from '../../components/ModelTags'
import {
  ColorModeButton,
  ColorSwatch,
  CUSTOM_COLOR_SWATCH_BACKGROUND,
} from '../../components/ui/ColorSwatch'
import { Field } from './FormField'

/** 不在预设色中，打开自定义取色器时可明确进入“自定义”状态。 */
const CUSTOM_COLOR_SEED = '#6366f1'

function isPresetColor(color: string): boolean {
  return (MODEL_TAG_COLOR_PRESETS as readonly string[]).includes(color)
}

/**
 * 标签芯片输入：Enter / 逗号 / 顿号 / 失焦提交文字，点击已有芯片可设置自动、预设或自定义颜色。
 * 与用户端展示共用 ModelTagBadge，管理员配置时即所见即所得。
 */
export function TagsInput({
  label = '标签（可选）',
  tags,
  onChange,
  placeholder,
}: {
  label?: string
  tags: ModelTag[]
  onChange: (tags: ModelTag[]) => void
  placeholder?: string
}) {
  const inputId = useId()
  const descriptionId = `${inputId}-description`
  const [draft, setDraft] = useState('')
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [customPickerOpen, setCustomPickerOpen] = useState(false)
  const activeTag = tags.find((tag) => tag.label === activeLabel) ?? null
  const activeCustomColor =
    activeTag?.color && !isPresetColor(activeTag.color) ? activeTag.color : null

  const commitDraft = () => {
    // 支持一次粘贴多个（逗号/顿号分隔），统一去空白、去重、限量限长。
    const candidates = draft
      .split(/[,，、]/)
      .map((candidate) => candidate.trim())
      .filter(Boolean)
    if (candidates.length === 0) {
      setDraft('')
      return
    }

    const next = [...tags]
    for (const candidate of candidates) {
      if (next.length >= MODEL_TAG_MAX_COUNT) break
      if (
        candidate.length > MODEL_TAG_MAX_LABEL_LENGTH ||
        next.some((tag) => tag.label === candidate)
      ) {
        continue
      }
      next.push({ label: candidate, color: null })
    }
    onChange(next)
    setDraft('')
  }

  const removeTag = (tagLabel: string) => {
    onChange(tags.filter((tag) => tag.label !== tagLabel))
    if (activeLabel === tagLabel) {
      setActiveLabel(null)
      setCustomPickerOpen(false)
    }
  }

  const toggleColorEditor = (tagLabel: string) => {
    setActiveLabel((current) => (current === tagLabel ? null : tagLabel))
    setCustomPickerOpen(false)
  }

  const updateTagColor = (tagLabel: string, color: string | null) => {
    onChange(
      tags.map((tag) =>
        tag.label === tagLabel ? { ...tag, color: color?.toLowerCase() ?? null } : tag,
      ),
    )
  }

  const chooseColor = (color: string | null) => {
    if (!activeTag) return
    updateTagColor(activeTag.label, color)
    setCustomPickerOpen(false)
  }

  const toggleCustomPicker = () => {
    if (!activeTag) return
    const opening = !customPickerOpen
    if (opening && !activeCustomColor) updateTagColor(activeTag.label, CUSTOM_COLOR_SEED)
    setCustomPickerOpen(opening)
  }

  return (
    <Field label={label} htmlFor={inputId}>
      {/* content-center + 统一 h-6 行高：单行/换行时芯片与输入框都稳定垂直居中。 */}
      <div className="flex min-h-11 w-full flex-wrap content-center items-center gap-x-1 gap-y-1 rounded-xl border border-neutral-300 bg-white px-2 py-1.5 transition focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:focus-within:border-sky-400">
        {tags.map((tag) => {
          const colorEditorOpen = activeTag?.label === tag.label
          return (
            <span
              key={tag.label}
              className={clsx(
                'group/tag inline-flex h-6 items-center gap-0.5 rounded-lg pl-1 pr-0.5 transition',
                colorEditorOpen
                  ? 'bg-sky-50 dark:bg-sky-500/15'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-700/60',
              )}
            >
              <button
                type="button"
                onClick={() => toggleColorEditor(tag.label)}
                aria-label={`设置标签 ${tag.label} 的颜色`}
                aria-expanded={colorEditorOpen}
                className="flex items-center rounded transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <ModelTagBadge tag={tag} className="!max-w-none !text-xs" />
              </button>
              <button
                type="button"
                onClick={() => removeTag(tag.label)}
                aria-label={`删除标签 ${tag.label}`}
                className="flex h-4 w-4 items-center justify-center rounded-full text-neutral-400 opacity-60 transition hover:bg-neutral-200 hover:text-neutral-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 group-hover/tag:opacity-100 dark:hover:bg-neutral-600 dark:hover:text-neutral-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}
        <input
          id={inputId}
          aria-describedby={descriptionId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' ||
              event.key === ',' ||
              event.key === '，' ||
              event.key === '、'
            ) {
              event.preventDefault()
              commitDraft()
            } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
              removeTag(tags[tags.length - 1]!.label)
            }
          }}
          onBlur={commitDraft}
          disabled={tags.length >= MODEL_TAG_MAX_COUNT && draft === ''}
          placeholder={
            tags.length >= MODEL_TAG_MAX_COUNT
              ? `最多 ${MODEL_TAG_MAX_COUNT} 个标签`
              : (placeholder ?? '输入后回车添加')
          }
          className="h-6 min-w-24 flex-1 bg-transparent px-0.5 text-sm outline-none placeholder:text-neutral-400 dark:text-neutral-100"
        />
      </div>

      {activeTag && (
        <div
          data-testid="model-tag-color-editor"
          className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3 dark:border-neutral-700 dark:bg-neutral-800/50"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs font-medium text-neutral-600 dark:text-neutral-300">
              <span className="text-neutral-400">标签颜色 · </span>
              <span className="truncate">{activeTag.label}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveLabel(null)
                setCustomPickerOpen(false)
              }}
              aria-label="关闭标签颜色设置"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-200/70 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {/* 「自动」不是一种颜色，用带文字的胶囊而非彩虹球，语义比色块更直白。 */}
            <ColorModeButton
              onClick={() => chooseColor(null)}
              aria-label="自动配色"
              selected={activeTag.color === null}
              surface="panel"
              title="自动配色（按标签文字）"
            >
              <Sparkles className="h-3.5 w-3.5" />
              自动
            </ColorModeButton>

            {/* 自动配色与固定色分组，视觉上区分“跟随文字”与“指定颜色”。 */}
            <span aria-hidden className="h-5 w-px bg-neutral-300 dark:bg-neutral-600" />

            {MODEL_TAG_COLOR_PRESETS.map((preset) => (
              <ColorSwatch
                key={preset}
                onClick={() => chooseColor(preset)}
                aria-label={`使用颜色 ${preset}`}
                selected={activeTag.color === preset}
                surface="panel"
                style={{ backgroundColor: preset }}
              >
                {activeTag.color === preset && (
                  <Check
                    className="h-3.5 w-3.5 text-white [filter:drop-shadow(0_1px_1.5px_rgb(0_0_0/0.55))]"
                    strokeWidth={3}
                  />
                )}
              </ColorSwatch>
            ))}

            <span aria-hidden className="h-5 w-px bg-neutral-300 dark:bg-neutral-600" />

            <ColorSwatch
              onClick={toggleCustomPicker}
              aria-label="自定义标签颜色"
              aria-expanded={customPickerOpen}
              selected={activeCustomColor !== null}
              surface="panel"
              title="自定义颜色"
              className="text-white"
              style={{
                background: activeCustomColor ?? CUSTOM_COLOR_SWATCH_BACKGROUND,
              }}
            >
              {activeCustomColor && !customPickerOpen ? (
                <Check className="h-3.5 w-3.5 drop-shadow" strokeWidth={3} />
              ) : (
                <Pipette className="h-3.5 w-3.5 drop-shadow" />
              )}
            </ColorSwatch>
          </div>

          {customPickerOpen && (
            <div className="hc-color-picker mt-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
              <HexColorPicker
                color={activeTag.color ?? CUSTOM_COLOR_SEED}
                onChange={(color) => updateTagColor(activeTag.label, color)}
              />
              <div className="mt-2.5 flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-8 w-8 shrink-0 rounded-lg border border-black/5 dark:border-white/10"
                  style={{ backgroundColor: activeTag.color ?? CUSTOM_COLOR_SEED }}
                />
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
                    #
                  </span>
                  <HexColorInput
                    color={activeTag.color ?? CUSTOM_COLOR_SEED}
                    onChange={(color) => updateTagColor(activeTag.label, color)}
                    aria-label="标签十六进制颜色值"
                    className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 pl-6 pr-2.5 font-mono text-sm text-neutral-900 outline-none transition focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <p id={descriptionId} className="mt-1 text-xs leading-5 text-neutral-400">
        直接展示在用户的模型列表里；点击标签可设置颜色。每个不超过 {MODEL_TAG_MAX_LABEL_LENGTH}{' '}
        字，最多 {MODEL_TAG_MAX_COUNT} 个。
      </p>
    </Field>
  )
}
