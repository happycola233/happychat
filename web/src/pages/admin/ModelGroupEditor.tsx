import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Pipette, Sparkles } from 'lucide-react'
import { HexColorInput, HexColorPicker } from 'react-colorful'
import type { AdminModelGroupDTO } from '@shared/types/api'
import type { ModelIcon } from '@shared/types/domain'
import { resolveModelGroupColor } from '@shared/util/modelGroupAppearance'
import * as adminApi from '../../api/admin'
import { IconPicker } from '../../components/IconPicker'
import { ModelGroupGlyph } from '../../components/ModelIcon'
import {
  FOLDER_COLOR_PRESETS,
  FOLDER_CUSTOM_COLOR_SEED,
  FOLDER_CUSTOM_COLOR_SWATCH_BACKGROUND,
  FOLDER_CUSTOM_COLOR_SWATCH_ICON_COLOR,
} from '../../components/colorPresets'
import { Button } from '../../components/ui/Button'
import { ColorModeButton, ColorSwatch } from '../../components/ui/ColorSwatch'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../store/toast'
import { Field } from './FormField'

/**
 * 模型分组的新建 / 编辑弹窗。
 * 颜色区与聊天文件夹共用柔和浅色色板，并保留「默认 + 预设 + 自定义」三段式交互。
 */
export function ModelGroupEditor({
  group,
  onClose,
}: {
  group: AdminModelGroupDTO | null
  onClose: () => void
}) {
  const isCreate = group === null
  const qc = useQueryClient()
  const nameId = useId()
  const [name, setName] = useState(group?.name ?? '')
  const [icon, setIcon] = useState<ModelIcon | null>(group?.icon ?? null)
  // 选择了显式图标后由图标自身决定外观；旧数据即使同时存了颜色，也不把无效值带回表单。
  const [color, setColor] = useState<string | null>(
    resolveModelGroupColor(group?.icon, group?.color),
  )
  const [customPickerOpen, setCustomPickerOpen] = useState(false)

  const isPresetColor =
    color !== null && (FOLDER_COLOR_PRESETS as readonly string[]).includes(color)
  const customColor = color !== null && !isPresetColor ? color : null

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), icon, color: resolveModelGroupColor(icon, color) }
      if (isCreate) await adminApi.createModelGroup(payload)
      else await adminApi.updateModelGroup(group.id, payload)
    },
    onSuccess: () => {
      toast.success(isCreate ? '已创建分组' : '已保存')
      void qc.invalidateQueries({ queryKey: ['admin', 'model-groups'] })
      // 分组改动会直接影响用户端选择器的分区结构。
      void qc.invalidateQueries({ queryKey: ['models'] })
      onClose()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '保存失败'),
  })

  const canSave = name.trim().length > 0 && !save.isPending

  const changeIcon = (nextIcon: ModelIcon | null) => {
    setIcon(nextIcon)
    if (nextIcon) {
      setColor(null)
      setCustomPickerOpen(false)
    }
  }

  return (
    <Modal
      open
      onClose={save.isPending ? () => {} : onClose}
      title={isCreate ? '新建模型分组' : `编辑分组 · ${group.name}`}
      size="form"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            取消
          </Button>
          <Button onClick={() => save.mutate()} disabled={!canSave} loading={save.isPending}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 实时预览：与用户端选择器里渲染的是同一个组件 */}
        <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-900/60">
          <ModelGroupGlyph group={{ icon, color }} size="md" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
              {name.trim() || '未命名分组'}
            </div>
            <div className="text-xs text-neutral-400 dark:text-neutral-500">用户端显示效果</div>
          </div>
        </div>

        <Field label="分组名称" htmlFor={nameId}>
          <input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            placeholder="如：OpenAI / 推理模型 / 生图"
            autoFocus
            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
          />
        </Field>

        <IconPicker
          value={icon}
          onChange={changeIcon}
          emptyHint="未设置图标，将显示可自定义颜色的默认文件夹图形"
        />

        {!icon && (
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              颜色（可选）
            </legend>
            <div className="flex flex-wrap items-center gap-2">
              <ColorModeButton
                onClick={() => {
                  setColor(null)
                  setCustomPickerOpen(false)
                }}
                aria-label="默认颜色"
                selected={color === null}
                title="使用默认颜色"
              >
                <Sparkles className="h-3.5 w-3.5" />
                默认
              </ColorModeButton>
              <span aria-hidden className="h-5 w-px bg-neutral-300 dark:bg-neutral-600" />
              {FOLDER_COLOR_PRESETS.map((preset) => (
                <ColorSwatch
                  key={preset}
                  onClick={() => {
                    setColor(preset)
                    setCustomPickerOpen(false)
                  }}
                  aria-label={`使用颜色 ${preset}`}
                  selected={color === preset}
                  style={{ backgroundColor: preset }}
                >
                  {color === preset && (
                    <Check
                      className="h-3.5 w-3.5 text-neutral-800 [filter:drop-shadow(0_1px_1px_rgb(255_255_255/0.65))]"
                      strokeWidth={3}
                    />
                  )}
                </ColorSwatch>
              ))}
              <span aria-hidden className="h-5 w-px bg-neutral-300 dark:bg-neutral-600" />
              <ColorSwatch
                onClick={() => {
                  const opening = !customPickerOpen
                  if (opening && !customColor) setColor(FOLDER_CUSTOM_COLOR_SEED)
                  setCustomPickerOpen(opening)
                }}
                aria-label="自定义颜色"
                aria-expanded={customPickerOpen}
                selected={customColor !== null}
                title="自定义颜色"
                className="text-white"
                style={{
                  background: customColor ?? FOLDER_CUSTOM_COLOR_SWATCH_BACKGROUND,
                }}
              >
                {customColor && !customPickerOpen ? (
                  <Check className="h-3.5 w-3.5 drop-shadow" strokeWidth={3} />
                ) : (
                  <Pipette
                    className={
                      customColor
                        ? 'h-3.5 w-3.5 drop-shadow'
                        : 'h-3.5 w-3.5 [filter:drop-shadow(0_1px_1px_rgb(255_255_255/0.75))]'
                    }
                    style={
                      customColor ? undefined : { color: FOLDER_CUSTOM_COLOR_SWATCH_ICON_COLOR }
                    }
                  />
                )}
              </ColorSwatch>
            </div>
            {customPickerOpen && (
              <div className="hc-color-picker mt-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
                <HexColorPicker color={color ?? FOLDER_CUSTOM_COLOR_SEED} onChange={setColor} />
                <div className="mt-2.5 flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-8 w-8 shrink-0 rounded-lg border border-black/5 dark:border-white/10"
                    style={{ backgroundColor: color ?? FOLDER_CUSTOM_COLOR_SEED }}
                  />
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
                      #
                    </span>
                    <HexColorInput
                      color={color ?? FOLDER_CUSTOM_COLOR_SEED}
                      onChange={setColor}
                      aria-label="分组十六进制颜色值"
                      className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 pl-6 pr-2.5 font-mono text-sm text-neutral-900 outline-none transition focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </fieldset>
        )}
      </div>
    </Modal>
  )
}
