import type { KeyboardEventHandler } from 'react'
import { clsx } from 'clsx'
import { ChevronDown } from 'lucide-react'
import { FolderGlyph } from './folderVisuals'

interface FolderIdentityFieldProps {
  name: string
  color: string | null
  emoji: string | null
  iconPickerOpen: boolean
  autoFocusName: boolean
  onNameChange: (name: string) => void
  onNameKeyDown: KeyboardEventHandler<HTMLInputElement>
  onToggleIconPicker: () => void
}

/**
 * 文件夹图标与名称保持为两个清晰的控件。图标触发器只固定交互尺寸，
 * 不给图形本身增加底板、边框或装饰角标。
 */
export function FolderIdentityField({
  name,
  color,
  emoji,
  iconPickerOpen,
  autoFocusName,
  onNameChange,
  onNameKeyDown,
  onToggleIconPicker,
}: FolderIdentityFieldProps) {
  return (
    <div data-testid="folder-identity-field" className="flex h-11 items-center gap-2">
      <button
        type="button"
        onClick={onToggleIconPicker}
        aria-label="选择文件夹图标"
        title="选择文件夹图标"
        aria-expanded={iconPickerOpen}
        aria-controls="folder-emoji-picker-panel"
        className="flex h-11 w-10 shrink-0 items-center justify-start gap-0.5 border-0 bg-transparent text-neutral-400 transition hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:text-neutral-500 dark:hover:text-neutral-200 dark:focus-visible:ring-neutral-500"
      >
        <FolderGlyph folder={{ color, emoji }} size="lg" />
        <ChevronDown
          aria-hidden
          className={clsx(
            'h-3 w-3 shrink-0 transition-transform duration-200',
            iconPickerOpen && 'rotate-180',
          )}
          strokeWidth={1.75}
        />
      </button>
      <input
        // 桌面端保留打开即输入；移动端不主动唤起软键盘。
        autoFocus={autoFocusName}
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        onKeyDown={onNameKeyDown}
        maxLength={40}
        placeholder="文件夹名称"
        aria-label="文件夹名称"
        data-testid="folder-name-input"
        className="h-11 min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-500"
      />
    </div>
  )
}
