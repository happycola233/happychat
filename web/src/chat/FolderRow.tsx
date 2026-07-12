import { clsx } from 'clsx'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import type { FolderDTO } from '@shared/types/api'
import { DeleteIcon, EditIcon, PinnedIcon, UnpinIcon } from './icons'
import { FolderGlyph } from './folderVisuals'
import { RowMenuItem } from './RowMenuItem'
import { HOVER_CONCEAL_CLASS, HOVER_REVEAL_CLASS, useRowMenu } from './rowMenu'

/**
 * 侧栏文件夹行：点击展开/收起成员列表；hover 三点菜单提供设置/置顶/删除。
 * 展开的成员列表由父级作为 children 渲染在行下方（缩进 + 引导线）。
 */
export function FolderRow({
  folder,
  count,
  expanded,
  containsActive,
  batchMode,
  onToggleExpand,
  onEdit,
  onTogglePin,
  onDelete,
  children,
}: {
  folder: FolderDTO
  /** 文件夹内聊天数（显示在行尾，hover 时让位给菜单按钮） */
  count: number
  expanded: boolean
  /** 折叠时若当前会话在此文件夹内，行高亮提示所在位置 */
  containsActive: boolean
  /** 批量模式下隐藏行内菜单，行仅承担展开/收起 */
  batchMode: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onTogglePin: (pinned: boolean) => void
  onDelete: () => void
  children?: React.ReactNode
}) {
  const pinned = Boolean(folder.pinnedAt)
  const { menuOpen, setMenuOpen, menuPlacement, menuRef, rowRef, toggleMenu } = useRowMenu()

  return (
    <li data-folder-id={folder.id}>
      <div
        ref={rowRef}
        className={clsx(
          'group relative flex items-center rounded-lg px-2.5 py-1.5 text-[13px] transition',
          containsActive && !expanded
            ? 'bg-neutral-200/60 dark:bg-neutral-800/70'
            : 'hover:bg-neutral-200/70 dark:hover:bg-neutral-800',
          menuOpen && 'bg-neutral-200/70 dark:bg-neutral-800',
        )}
      >
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          title={folder.name}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-neutral-900 dark:text-neutral-100"
        >
          <FolderGlyph folder={folder} />
          <span className="min-w-0 truncate font-medium">{folder.name}</span>
          <ChevronRight
            className={clsx(
              'h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        </button>

        {!batchMode ? (
          <>
            {count > 0 && (
              <span
                aria-hidden
                className={clsx(
                  'pointer-events-none absolute right-3 text-[11px] tabular-nums text-neutral-400 transition',
                  HOVER_CONCEAL_CLASS,
                )}
              >
                {count}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleMenu()
              }}
              className={clsx(
                'absolute right-1 rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-700 dark:hover:text-neutral-100',
                menuOpen ? 'opacity-100' : HOVER_REVEAL_CLASS,
              )}
              aria-label="文件夹操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </>
        ) : (
          count > 0 && (
            <span aria-hidden className="text-[11px] tabular-nums text-neutral-400">
              {count}
            </span>
          )
        )}

        {menuOpen && (
          <div
            ref={menuRef}
            className={clsx(
              'hc-pop-in absolute right-0 z-40 w-40 rounded-xl border border-neutral-200 bg-white p-1 text-[13px] shadow-2xl dark:border-neutral-700 dark:bg-neutral-900',
              menuPlacement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
            )}
          >
            <RowMenuItem
              icon={<EditIcon className="h-4 w-4" />}
              onClick={() => {
                setMenuOpen(false)
                onEdit()
              }}
            >
              文件夹设置
            </RowMenuItem>
            <RowMenuItem
              icon={pinned ? <UnpinIcon className="h-4 w-4" /> : <PinnedIcon className="h-4 w-4" />}
              onClick={() => {
                setMenuOpen(false)
                onTogglePin(!pinned)
              }}
            >
              {pinned ? '取消置顶' : '置顶'}
            </RowMenuItem>
            <RowMenuItem
              icon={<DeleteIcon className="h-4 w-4" />}
              danger
              onClick={() => {
                setMenuOpen(false)
                onDelete()
              }}
            >
              删除
            </RowMenuItem>
          </div>
        )}
      </div>
      {children}
    </li>
  )
}
