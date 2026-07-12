import type { CSSProperties } from 'react'
import { clsx } from 'clsx'
import { Folder } from 'lucide-react'
import type { FolderDTO } from '@shared/types/api'

type GlyphSize = 'xs' | 'sm' | 'lg'

const GLYPH_SIZE_CLASS: Record<GlyphSize, string> = {
  xs: 'h-5 w-5 rounded-md text-[12px]',
  sm: 'h-6 w-6 rounded-lg text-[14px]',
  lg: 'h-11 w-11 rounded-xl text-[24px]',
}

const GLYPH_ICON_CLASS: Record<GlyphSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  lg: 'h-[22px] w-[22px]',
}

/** 文件夹图标芯片：Emoji 或默认文件夹图形，底色随主题色淡染。 */
export function FolderGlyph({
  folder,
  size = 'sm',
  className,
}: {
  folder: Pick<FolderDTO, 'color' | 'emoji'>
  size?: GlyphSize
  className?: string
}) {
  const style = folder.color ? ({ '--hc-folder-color': folder.color } as CSSProperties) : undefined
  return (
    <span
      aria-hidden
      className={clsx(
        'flex shrink-0 items-center justify-center leading-none',
        GLYPH_SIZE_CLASS[size],
        folder.color
          ? 'hc-folder-glyph'
          : 'bg-neutral-200/70 text-neutral-500 dark:bg-neutral-700/60 dark:text-neutral-300',
        className,
      )}
      style={style}
    >
      {folder.emoji ?? (
        // fill=currentColor 让 lucide 线框图标变成实心块，作为芯片里的默认图形更醒目。
        <Folder className={GLYPH_ICON_CLASS[size]} fill="currentColor" strokeWidth={1} />
      )}
    </span>
  )
}
