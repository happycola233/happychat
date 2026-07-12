import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { EmojiPicker } from 'frimousse'
import type {
  EmojiPickerListCategoryHeaderProps,
  EmojiPickerListEmojiProps,
  EmojiPickerListRowProps,
} from 'frimousse'

/** Emoji 单元格的理想边长（px）：先按它取整列数，再均分可用宽度得到实际边长。 */
const EMOJI_CELL_IDEAL_PX = 40
/** viewport 左右 padding（px-1.5×2）+ 滚动条 gutter 的预留宽度。 */
const VIEWPORT_CHROME_PX = 22

// 自定义渲染组件必须保持模块级稳定引用：若在面板组件里内联创建，
// 面板每次重渲染（如父弹窗输入名称）都会生成新的组件身份，
// frimousse 会把整个虚拟化列表卸载重建，滚动/交互明显变卡。
function CategoryHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      className="bg-white px-1.5 pb-1 pt-2.5 text-xs font-medium text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500"
      {...props}
    >
      {category.label}
    </div>
  )
}

function Row({ children, ...props }: EmojiPickerListRowProps) {
  return (
    <div className="scroll-my-1" {...props}>
      {children}
    </div>
  )
}

function Emoji({ emoji, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button
      type="button"
      // 悬浮显示表情的中文名称
      title={emoji.label}
      // 单元格边长来自面板容器上的 CSS 变量（列数 × 边长 = 可用宽度，网格铺满无空带）
      className="flex h-[var(--hc-emoji-cell)] w-[var(--hc-emoji-cell)] items-center justify-center rounded-lg text-[21px] leading-none transition data-[active]:bg-neutral-200/80 dark:data-[active]:bg-neutral-700/80"
      {...props}
    >
      {emoji.emoji}
    </button>
  )
}

/**
 * Emoji 选择面板：基于 frimousse（Liveblocks 出品的 headless emoji picker，
 * shadcn/ui 官方 emoji picker 的底层实现）。headless 方案让样式完全走项目
 * 自身的 Tailwind 体系，深浅色自然适配；emoji 数据（含中文搜索词）从
 * 同源 `/api/emoji-data` 按需拉取（服务端自托管 Emojibase，不依赖公网 CDN），
 * frimousse 会缓存进 localStorage。经 React.lazy 懒加载，不进主包。
 */
export default function EmojiPickerPanel({
  autoFocusSearch,
  onSelect,
}: {
  /** 桌面端可直接搜索；移动端关闭，避免点开图标面板时再次唤起软键盘。 */
  autoFocusSearch: boolean
  onSelect: (emoji: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  // 网格参数在首次布局时按容器宽度计算：虚拟化要求单元格尺寸固定（不能 flex 拉伸，
  // 否则分类末行不满时按钮会被拉宽），所以列数取整后把可用宽度均分成固定边长。
  const [grid, setGrid] = useState<{ columns: number; cellPx: number } | null>(null)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const compute = () => {
      const available = el.clientWidth - VIEWPORT_CHROME_PX
      const columns = Math.max(5, Math.round(available / EMOJI_CELL_IDEAL_PX))
      setGrid({ columns, cellPx: Math.floor((available / columns) * 100) / 100 })
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 w-full"
      style={grid ? ({ '--hc-emoji-cell': `${grid.cellPx}px` } as CSSProperties) : undefined}
    >
      {grid !== null && (
        <EmojiPicker.Root
          locale="zh"
          emojibaseUrl="/api/emoji-data"
          columns={grid.columns}
          onEmojiSelect={({ emoji }) => onSelect(emoji)}
          className="flex h-full w-full flex-col"
        >
          {/* 抬高层级并带背景：粘性分类头等 viewport 内元素在任何浏览器/缩放下都不会盖到搜索框 */}
          <div className="relative z-10 bg-white px-2.5 pb-2 pt-2.5 dark:bg-neutral-900">
            <EmojiPicker.Search
              autoFocus={autoFocusSearch}
              placeholder="搜索表情…"
              className="w-full rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[13px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:ring-1 focus:ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:ring-neutral-600"
            />
          </div>
          <EmojiPicker.Viewport className="hc-scrollbar relative flex-1 overflow-y-auto px-1.5 pb-1.5 outline-none">
            <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-[13px] text-neutral-400">
              表情加载中…
            </EmojiPicker.Loading>
            <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-[13px] text-neutral-400">
              没有找到相关表情
            </EmojiPicker.Empty>
            <EmojiPicker.List
              className="select-none"
              // 虚拟化列表要求各部分尺寸稳定：分类头/行/按钮尺寸不要随内容变化。
              components={{ CategoryHeader, Row, Emoji }}
            />
          </EmojiPicker.Viewport>
        </EmojiPicker.Root>
      )}
    </div>
  )
}
