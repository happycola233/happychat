import { useId, useState } from 'react'
import { Check, Pipette, Sparkles, X } from 'lucide-react'
import { HexColorInput, HexColorPicker } from 'react-colorful'
import { clsx } from 'clsx'
import type { ModelTag } from '@shared/types/domain'
import { MODEL_TAG_MAX_LABEL_LENGTH } from '@shared/util/modelTags'
import { MODEL_TAG_COLOR_PRESETS } from '../../components/colorPresets'
import {
  ColorModeButton,
  ColorSwatch,
  CUSTOM_COLOR_SWATCH_BACKGROUND,
} from '../../components/ui/ColorSwatch'
import { inputClass } from '../../components/ui/controlStyles'
import { Field } from './FormField'

/** 不在预设色中，打开自定义取色器时可明确进入“自定义”状态。 */
const CUSTOM_COLOR_SEED = '#6366f1'

function isPresetColor(color: string): boolean {
  return (MODEL_TAG_COLOR_PRESETS as readonly string[]).includes(color)
}

export function ModelTagEditor({
  tag,
  error,
  onChange,
  onClose,
}: {
  tag: ModelTag
  error?: string
  onChange: (changes: Partial<ModelTag>) => void
  onClose: () => void
}) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const [customPickerOpen, setCustomPickerOpen] = useState(false)
  const customColor = tag.color && !isPresetColor(tag.color) ? tag.color : null

  const chooseColor = (color: string | null) => {
    onChange({ color })
    setCustomPickerOpen(false)
  }

  const toggleCustomPicker = () => {
    const opening = !customPickerOpen
    if (opening && !customColor) onChange({ color: CUSTOM_COLOR_SEED })
    setCustomPickerOpen(opening)
  }

  return (
    <div
      data-testid="model-tag-editor"
      className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3 dark:border-neutral-700 dark:bg-neutral-800/50"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">编辑标签</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起标签编辑"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-200/70 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>

      <Field label="标签文字" htmlFor={inputId}>
        <input
          id={inputId}
          autoFocus
          value={tag.label}
          maxLength={MODEL_TAG_MAX_LABEL_LENGTH}
          onChange={(event) => onChange({ label: event.target.value })}
          onBlur={() => onChange({ label: tag.label.trim() })}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
            if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
              event.preventDefault()
              if (!error) onClose()
            }
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={clsx(
            inputClass,
            error &&
              'border-red-400 focus:border-red-500 dark:border-red-500 dark:focus:border-red-400',
          )}
        />
        {error && (
          <p id={errorId} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </Field>

      <div data-testid="model-tag-color-editor" className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500 dark:text-neutral-400">颜色</span>
        {/* 「自动」不是一种颜色，用带文字的胶囊而非彩虹球，语义比色块更直白。 */}
        <ColorModeButton
          onClick={() => chooseColor(null)}
          aria-label="自动配色"
          selected={tag.color === null}
          surface="panel"
          title="自动配色（按标签文字）"
        >
          <Sparkles className="h-3.5 w-3.5" />
          自动
        </ColorModeButton>
        <span aria-hidden className="h-5 w-px bg-neutral-300 dark:bg-neutral-600" />

        {MODEL_TAG_COLOR_PRESETS.map((preset) => (
          <ColorSwatch
            key={preset}
            onClick={() => chooseColor(preset)}
            aria-label={`使用颜色 ${preset}`}
            selected={tag.color === preset}
            surface="panel"
            style={{ backgroundColor: preset }}
          >
            {tag.color === preset && (
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
          selected={customColor !== null}
          surface="panel"
          title="自定义颜色"
          className="text-white"
          style={{
            backgroundColor: customColor ?? 'transparent',
            backgroundImage: customColor ? 'none' : CUSTOM_COLOR_SWATCH_BACKGROUND,
          }}
        >
          {customColor && !customPickerOpen ? (
            <Check className="h-3.5 w-3.5 drop-shadow" strokeWidth={3} />
          ) : (
            <Pipette className="h-3.5 w-3.5 drop-shadow" />
          )}
        </ColorSwatch>
      </div>

      {customPickerOpen && (
        <div className="hc-color-picker mt-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
          <HexColorPicker
            color={tag.color ?? CUSTOM_COLOR_SEED}
            onChange={(color) => onChange({ color: color.toLowerCase() })}
          />
          <div className="mt-2.5 flex items-center gap-2">
            <span
              aria-hidden
              className="h-8 w-8 shrink-0 rounded-lg border border-black/5 dark:border-white/10"
              style={{ backgroundColor: tag.color ?? CUSTOM_COLOR_SEED }}
            />
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
                #
              </span>
              <HexColorInput
                color={tag.color ?? CUSTOM_COLOR_SEED}
                onChange={(color) => onChange({ color: color.toLowerCase() })}
                aria-label="标签十六进制颜色值"
                className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 pl-6 pr-2.5 font-mono text-sm text-neutral-900 outline-none transition focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
