// 统一的表格样式类，保证各管理页表格深浅色一致。

/**
 * 宽表的横向滚动容器：窄屏贴边（-mx-4 + px-4）以获得完整可视宽度，
 * sm 及以上恢复常规内边距。配合内层 `tableShell + min-w-[...]` 使用，
 * 让列不足时横向滚动而非被挤压。这里不要限制 touch-action 为 pan-x，
 * 否则移动端从表格区域起手的纵向拖动不会传给页面滚动容器。
 */
export const tableScroll =
  'hc-scrollbar -mx-4 overflow-x-auto overscroll-x-contain px-4 pb-1 sm:mx-0 sm:px-0'

export const tableShell =
  'overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xs dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none'
export const tableEl = 'w-full text-sm'
// 表头轻量化：不再铺灰底，只靠更淡的小字号 + 底部分隔线与表体区分，视觉更透气。
export const tableHead =
  'border-b border-neutral-200 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500'
export const tableBody =
  'divide-y divide-neutral-100 bg-white dark:divide-neutral-800/70 dark:bg-neutral-900'
export const th = 'px-3.5 py-2.5 text-left font-medium whitespace-nowrap'
export const td = 'px-3.5 py-2.5 align-middle'
export const tableRowHover = 'transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-800/40'
