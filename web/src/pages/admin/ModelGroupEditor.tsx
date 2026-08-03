import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, Sparkles } from 'lucide-react'
import { HexColorInput, HexColorPicker } from 'react-colorful'
import type { AdminModelGroupDTO } from '@shared/types/api'
import type { ModelIcon } from '@shared/types/domain'
import * as adminApi from '../../api/admin'
import { IconPicker } from '../../components/IconPicker'
import { ModelGroupGlyph } from '../../components/ModelIcon'
import { COLOR_PRESETS } from '../../components/colorPresets'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../store/toast'
import { Field } from './FormField'

/** 打开自定义取色时的种子色，让状态明确是「自定义」而不是空。 */
const CUSTOM_COLOR_SEED = '#6366f1'

const swatchClass = 'h-6 w-6 rounded-full border border-black/10 transition dark:border-white/15'
const selectedSwatchClass = 'ring-2 ring-sky-500 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900'

/**
 * 模型分组的新建 / 编辑弹窗。
 * 颜色区沿用 TagsInput 的「自动 + 预设色板 + 自定义取色」三段式，视觉与交互保持一致。
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
  const [color, setColor] = useState<string | null>(group?.color ?? null)
  const [customPickerOpen, setCustomPickerOpen] = useState(false)

  const isPresetColor = color !== null && (COLOR_PRESETS as readonly string[]).includes(color)
  const customColor = color !== null && !isPresetColor ? color : null

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), icon, color }
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

        <IconPicker value={icon} onChange={setIcon} emptyHint="未设置图标，将显示默认文件夹图形" />

        <Field label="主题色（可选）" htmlFor={`${nameId}-color`}>
          <div className="flex flex-wrap items-center gap-1.5" id={`${nameId}-color`}>
            <button
              type="button"
              onClick={() => {
                setColor(null)
                setCustomPickerOpen(false)
              }}
              aria-pressed={color === null}
              className={clsx(
                'inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800',
                color === null && selectedSwatchClass,
              )}
            >
              <Sparkles className="h-3 w-3" />
              默认
            </button>
            <span aria-hidden className="h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setColor(preset)
                  setCustomPickerOpen(false)
                }}
                aria-label={`使用颜色 ${preset}`}
                aria-pressed={color === preset}
                style={{ backgroundColor: preset }}
                className={clsx(
                  swatchClass,
                  'flex items-center justify-center',
                  color === preset && selectedSwatchClass,
                )}
              >
                {color === preset && (
                  <Check className="h-3 w-3 text-white [filter:drop-shadow(0_1px_1px_rgb(0_0_0/0.4))]" />
                )}
              </button>
            ))}
            <span aria-hidden className="h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
            <button
              type="button"
              onClick={() => {
                if (!customColor) setColor(CUSTOM_COLOR_SEED)
                setCustomPickerOpen((v) => !v)
              }}
              aria-label="自定义颜色"
              aria-pressed={customColor !== null}
              style={
                customColor
                  ? { backgroundColor: customColor }
                  : {
                      background:
                        'conic-gradient(#ef4444,#f59e0b,#22c55e,#0ea5e9,#8b5cf6,#ec4899,#ef4444)',
                    }
              }
              className={clsx(
                swatchClass,
                'flex items-center justify-center',
                customColor !== null && selectedSwatchClass,
              )}
            >
              {customColor && (
                <Check className="h-3 w-3 text-white [filter:drop-shadow(0_1px_1px_rgb(0_0_0/0.4))]" />
              )}
            </button>
          </div>
          {customPickerOpen && (
            <div className="hc-color-picker mt-2 space-y-2">
              <HexColorPicker color={color ?? CUSTOM_COLOR_SEED} onChange={setColor} />
              <div className="relative w-28">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
                  #
                </span>
                <HexColorInput
                  color={color ?? CUSTOM_COLOR_SEED}
                  onChange={setColor}
                  className="h-8 w-full rounded-lg border border-neutral-200 bg-white pl-5 pr-2 text-sm uppercase outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500"
                />
              </div>
            </div>
          )}
        </Field>
      </div>
    </Modal>
  )
}
