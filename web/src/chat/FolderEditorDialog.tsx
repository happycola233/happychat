import { Suspense, lazy, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Check, Pipette } from 'lucide-react'
import { HexColorInput, HexColorPicker } from 'react-colorful'
import { DEFAULT_FOLDER_COLOR } from '@shared/constants'
import type { FolderDTO } from '@shared/types/api'
import {
  FOLDER_COLOR_PRESETS,
  FOLDER_CUSTOM_COLOR_SEED,
  FOLDER_CUSTOM_COLOR_SWATCH_BACKGROUND,
  FOLDER_CUSTOM_COLOR_SWATCH_ICON_COLOR,
} from '../components/colorPresets'
import { ColorSwatch } from '../components/ui/ColorSwatch'
import { useFolderActions } from '../hooks/useFolders'
import { useFolderEditor } from '../store/folderEditor'
import { useIsMobile } from '../store/sidebar'
import { FolderIdentityField } from './FolderIdentityField'

// Emoji 面板（frimousse）懒加载：只有打开图标选择时才请求该 chunk。
const EmojiPickerPanel = lazy(() => import('./EmojiPickerPanel'))

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
  const [color, setColor] = useState<string>(folder?.color ?? DEFAULT_FOLDER_COLOR)
  const [emoji, setEmoji] = useState<string | null>(folder?.emoji ?? null)
  const [panel, setPanel] = useState<ExpandedPanel>(null)
  const isMobile = useIsMobile()

  const saving = create.isPending || update.isPending
  const canSubmit = name.trim().length > 0 && !saving
  const isCustomColor = !(FOLDER_COLOR_PRESETS as readonly string[]).includes(color)

  // Escape：先收起展开的面板，再关闭弹窗（与嵌套弹层的直觉一致）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 不在 setState 的更新函数里关闭全局弹窗，否则会形成“渲染当前组件时
      // 更新外部 store”的 React 警告。
      if (panel) setPanel(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, panel])

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

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        data-testid="folder-editor"
        className={clsx(
          'hc-pop-in relative z-10 flex w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900',
          // Emoji 展开时给弹窗一个明确的视口内高度，让中间列表承担剩余空间；
          // 浏览器放大导致 CSS 视口变矮时，也不会再给整个弹窗套一层滚动条。
          panel === 'emoji' ? 'h-[min(38rem,calc(100dvh-2rem))]' : 'max-h-[calc(100dvh-2rem)]',
        )}
      >
        <h3 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
          {isEdit ? '文件夹设置' : '新建文件夹'}
        </h3>

        <div className="mt-4">
          <FolderIdentityField
            name={name}
            color={color}
            emoji={emoji}
            iconPickerOpen={panel === 'emoji'}
            autoFocusName={!isEdit && !isMobile}
            onNameChange={setName}
            onNameKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
            onToggleIconPicker={() => setPanel(panel === 'emoji' ? null : 'emoji')}
          />
        </div>

        {/* Emoji 选择面板（内联展开，避免小屏弹层溢出视口） */}
        {panel === 'emoji' && (
          <div
            id="folder-emoji-picker-panel"
            aria-label="选择文件夹图标"
            className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800"
          >
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-100 px-3 dark:border-neutral-800">
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                选择文件夹图标
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
                  恢复默认图标
                </button>
              )}
            </div>
            <Suspense
              fallback={
                <div className="flex h-full min-h-0 items-center justify-center text-[13px] text-neutral-400">
                  表情加载中…
                </div>
              }
            >
              <EmojiPickerPanel
                autoFocusSearch={!isMobile}
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
            {FOLDER_COLOR_PRESETS.map((preset) => (
              <ColorSwatch
                key={preset}
                onClick={() => {
                  setColor(preset)
                  if (panel === 'color') setPanel(null)
                }}
                aria-label={`颜色 ${preset}`}
                selected={color === preset}
                showSelectedRing={false}
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
            {/* 自定义取色 */}
            <ColorSwatch
              onClick={() => {
                if (panel !== 'color') {
                  if (!isCustomColor) setColor(FOLDER_CUSTOM_COLOR_SEED)
                  setPanel('color')
                } else {
                  setPanel(null)
                }
              }}
              aria-label="自定义颜色"
              title="自定义颜色"
              aria-expanded={panel === 'color'}
              selected={isCustomColor}
              showSelectedRing={false}
              className="text-white"
              style={{
                background: isCustomColor ? color : FOLDER_CUSTOM_COLOR_SWATCH_BACKGROUND,
              }}
            >
              {isCustomColor && panel !== 'color' ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              ) : (
                <Pipette
                  className={
                    isCustomColor
                      ? 'h-3.5 w-3.5 drop-shadow'
                      : 'h-3.5 w-3.5 [filter:drop-shadow(0_1px_1px_rgb(255_255_255/0.75))]'
                  }
                  style={
                    isCustomColor ? undefined : { color: FOLDER_CUSTOM_COLOR_SWATCH_ICON_COLOR }
                  }
                />
              )}
            </ColorSwatch>
          </div>
        </div>

        {/* 自定义取色面板（react-colorful，内联展开） */}
        {panel === 'color' && (
          <div className="hc-color-picker mt-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <HexColorPicker color={color} onChange={setColor} />
            <div className="mt-2.5 flex items-center gap-2">
              <span
                aria-hidden
                className="h-8 w-8 shrink-0 rounded-lg border border-black/5 dark:border-white/10"
                style={{ backgroundColor: color }}
              />
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
                  #
                </span>
                <HexColorInput
                  color={color}
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
