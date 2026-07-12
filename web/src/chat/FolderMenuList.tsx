import { Check, CornerUpLeft, FolderPlus } from 'lucide-react'
import type { FolderDTO } from '@shared/types/api'
import { FolderGlyph } from './folderVisuals'
import { RowMenuItem } from './RowMenuItem'

/**
 * 「移动到文件夹」目标列表：行内菜单二级视图与批量工具栏弹层共用。
 * onSelect(null) 表示移出文件夹。
 */
export function FolderMenuList({
  folders,
  currentFolderId,
  showRemove,
  onSelect,
  onCreateNew,
}: {
  folders: FolderDTO[]
  /** 当前所在文件夹（单会话移动时显示对勾）；批量场景传 undefined */
  currentFolderId?: string | null
  /** 是否显示「移出文件夹」项 */
  showRemove: boolean
  onSelect: (folderId: string | null) => void
  onCreateNew: () => void
}) {
  return (
    <div className="flex flex-col">
      {folders.length > 0 ? (
        <div className="hc-scrollbar max-h-56 space-y-0.5 overflow-y-auto">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => onSelect(folder.id)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <FolderGlyph folder={folder} size="xs" />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              {currentFolderId === folder.id && (
                <Check className="h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" />
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="px-2.5 py-2 text-xs text-neutral-400">还没有文件夹</p>
      )}

      <div className="mx-1 my-1 border-t border-neutral-100 dark:border-neutral-800" />
      {/* 菜单里的 lucide 图标统一压细笔画并缩小一号，与 fill 风格自绘图标的视觉重量一致 */}
      {showRemove && (
        <RowMenuItem
          icon={<CornerUpLeft className="!h-[15px] !w-[15px]" strokeWidth={1.6} />}
          onClick={() => onSelect(null)}
        >
          移出文件夹
        </RowMenuItem>
      )}
      <RowMenuItem
        icon={<FolderPlus className="!h-[15px] !w-[15px]" strokeWidth={1.6} />}
        onClick={onCreateNew}
      >
        新建文件夹…
      </RowMenuItem>
    </div>
  )
}
