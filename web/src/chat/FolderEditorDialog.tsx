import { Suspense, lazy, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Check, Pipette, SmilePlus } from 'lucide-react'
import { HexColorInput, HexColorPicker } from 'react-colorful'
import type { FolderDTO } from '@shared/types/api'
import { useFolderActions } from '../hooks/useFolders'
import { useFolderEditor } from '../store/folderEditor'
import { FOLDER_COLOR_PRESETS } from './folderColors'
import { FolderGlyph } from './folderVisuals'

// Emoji 面板（frimousse）懒加载：只有打开图标选择时才请求该 chunk。
const EmojiPickerPanel = lazy(() => import('./EmojiPickerPanel'))

/** 自定义取色的初始色（用户尚未选过颜色时的取色器起点）。 */
const CUSTOM_COLOR_SEED = '#0ea5e9'

type ExpandedPanel = 'emoji' | 'color' | null

function FolderEditorDialogInner({
  folder,
  onCreated,
  onClose,
}: {
  folder: FolderDTO | null
  onCreated: ((folder: FolderDTO) => void) | null
  onClose: () => void
}) {
  const isEdit = folder !== null
  const { create, update } = useFolderActions()
  const [name, setName] = useState(folder?.name ?? '')
  const [color, setColor] = useState<string | null>(folder?.color ?? null)
  const [emoji, setEmoji] = useState<string | null>(folder?.emoji ?? null)
  const [panel, setPanel] = useState<ExpandedPanel>(null)

  const saving = create.isPending || update.isPending
  const canSubmit = name.trim().length > 0 && !saving
  const isCustomColor =
    color !== null && !(FOLDER_COLOR_PRESETS as readonly string[]).includes(color)

  // Escape：先收起展开的面板，再关闭弹窗（与嵌套弹层的直觉一致）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setPanel((current) => {
        if (current) return null
        onClose()
        return current
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    try {
      if (isEdit) {
        await update.mutateAsync({ id: folder.id, patch: { name: trimmed, color, emoji } })
      } else {
        const created = await create.mutateAsync({ name: trimmed, color, emoji })
        onCreated?.(created)
      }
      onClose()
    } catch {
      // 错误已由 mutation onError 弹 toast，保持弹窗打开供用户重试。
    }
  }

  const swatchBase =
    'relative flex h-7 w-7 items-center justify-center rounded-full transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        data-testid="folder-editor"
        className="hc-pop-in hc-scrollbar relative z-10 max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <h3 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
          {isEdit ? '文件夹设置' : '新建文件夹'}
        </h3>

        {/* 图标 + 名称：图标按钮即实时预览 */}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPanel(panel === 'emoji' ? null : 'emoji')}
            aria-label="选择图标"
            title="选择图标"
            aria-expanded={panel === 'emoji'}
            className={clsx(
              'group relative rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
              panel === 'emoji'
                ? 'ring-2 ring-neutral-300 dark:ring-neutral-600'
                : 'hover:ring-2 hover:ring-neutral-200 dark:hover:ring-neutral-700',
            )}
          >
            <FolderGlyph folder={{ color, emoji }} size="lg" />
            <span className="absolute -bottom-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              <SmilePlus className="h-3 w-3" />
            </span>
          </button>
          <input
            autoFocus={!isEdit}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
            maxLength={40}
            placeholder="文件夹名称"
            aria-label="文件夹名称"
            data-testid="folder-name-input"
            className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500"
          />
        </div>

        {/* Emoji 选择面板（内联展开，避免小屏弹层溢出视口） */}
        {panel === 'emoji' && (
          <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between px-2.5 pt-2">
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                选择图标
              </span>
              {emoji && (
                <button
                  type="button"
                  onClick={() => {
                    setEmoji(null)
                    setPanel(null)
                  }}
                  className="rounded-md px-1.5 py-0.5 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                >
                  移除图标
                </button>
              )}
            </div>
            <Suspense
              fallback={
                <div className="flex h-[286px] items-center justify-center text-[13px] text-neutral-400">
                  表情加载中…
                </div>
              }
            >
              <EmojiPickerPanel
                onSelect={(selected) => {
                  setEmoji(selected)
                  setPanel(null)
                }}
              />
            </Suspense>
          </div>
        )}

        {/* 颜色 */}
        <div className="mt-4">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            文件夹颜色
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* 默认（无颜色） */}
            <button
              type="button"
              onClick={() => {
                setColor(null)
                if (panel === 'color') setPanel(null)
              }}
              aria-label="默认颜色"
              title="默认"
              className={clsx(swatchBase, 'bg-neutral-300 dark:bg-neutral-600')}
            >
              {color === null && (
                <Check
                  className="h-3.5 w-3.5 text-neutral-700 dark:text-neutral-100"
                  strokeWidth={3}
                />
              )}
            </button>
            {FOLDER_COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setColor(preset)
                  if (panel === 'color') setPanel(null)
                }}
                aria-label={`颜色 ${preset}`}
                className={swatchBase}
                style={{ backgroundColor: preset }}
              >
                {color === preset && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
            {/* 自定义取色 */}
            <button
              type="button"
              onClick={() => {
                if (panel !== 'color') {
                  if (!isCustomColor) setColor(color ?? CUSTOM_COLOR_SEED)
                  setPanel('color')
                } else {
                  setPanel(null)
                }
              }}
              aria-label="自定义颜色"
              title="自定义颜色"
              aria-expanded={panel === 'color'}
              className={clsx(swatchBase, 'text-white')}
              style={{
                background: isCustomColor
                  ? color
                  : 'conic-gradient(#ef4444, #f59e0b, #22c55e, #0ea5e9, #8b5cf6, #ec4899, #ef4444)',
              }}
            >
              {isCustomColor && panel !== 'color' ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              ) : (
                <Pipette className="h-3.5 w-3.5 drop-shadow" />
              )}
            </button>
          </div>
        </div>

        {/* 自定义取色面板（react-colorful，内联展开） */}
        {panel === 'color' && (
          <div className="hc-color-picker mt-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <HexColorPicker color={color ?? CUSTOM_COLOR_SEED} onChange={setColor} />
            <div className="mt-2.5 flex items-center gap-2">
              <span
                aria-hidden
                className="h-8 w-8 shrink-0 rounded-lg border border-black/5 dark:border-white/10"
                style={{ backgroundColor: color ?? CUSTOM_COLOR_SEED }}
              />
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
                  #
                </span>
                <HexColorInput
                  color={color ?? CUSTOM_COLOR_SEED}
                  onChange={setColor}
                  aria-label="十六进制颜色值"
                  className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 pl-6 pr-2.5 font-mono text-sm text-neutral-900 outline-none transition focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500"
                />
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3.5 py-2 text-sm text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            data-testid="folder-editor-submit"
            className="rounded-xl bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {isEdit ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 文件夹设置弹窗宿主：ChatLayout 挂载一份，各入口经 useFolderEditor 打开。 */
export function FolderEditorDialog() {
  const { open, folder, onCreated, close } = useFolderEditor()
  if (!open) return null
  // key 让「编辑 A → 编辑 B」时内部草稿状态重置。
  return (
    <FolderEditorDialogInner
      key={folder?.id ?? 'create'}
      folder={folder}
      onCreated={onCreated}
      onClose={close}
    />
  )
}
