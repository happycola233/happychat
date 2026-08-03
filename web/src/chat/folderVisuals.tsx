import type { CSSProperties } from 'react'
import { clsx } from 'clsx'
import { Folder } from 'lucide-react'
import type { FolderDTO } from '@shared/types/api'
import { ICON_EMOJI_CLASS, ICON_SIZE_CLASS, type IconSize } from '../components/iconSizing'

type FolderGlyphSize = Exclude<IconSize, 'md'>

/** 文件夹裸图标：按 Emoji 或默认文件夹图形本身的尺寸占位。 */
export function FolderGlyph({
  folder,
  size = 'sm',
  className,
}: {
  folder: Pick<FolderDTO, 'color' | 'emoji'>
  size?: FolderGlyphSize
  className?: string
}) {
  const style = folder.color ? ({ '--hc-glyph-color': folder.color } as CSSProperties) : undefined
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-flex shrink-0 items-center justify-center leading-none',
        ICON_SIZE_CLASS[size],
        folder.emoji && ICON_EMOJI_CLASS[size],
        folder.color ? 'hc-colored-glyph' : 'text-neutral-500 dark:text-neutral-300',
        className,
      )}
      style={style}
    >
      {folder.emoji ?? (
        // fill=currentColor 让默认文件夹保持清晰的实心轮廓。
        <Folder className="h-full w-full" fill="currentColor" strokeWidth={1} />
      )}
    </span>
  )
}
