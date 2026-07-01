// 统一的表格样式类，保证各管理页表格深浅色一致。

/**
 * 宽表的横向滚动容器：窄屏贴边（-mx-4 + px-4）以获得完整可视宽度，
 * sm 及以上恢复常规内边距。配合内层 `tableShell + min-w-[...]` 使用，
 * 让列不足时横向滚动而非被挤压。
 */
export const tableScroll =
  'hc-scrollbar -mx-4 overflow-x-auto overscroll-x-contain px-4 pb-1 [touch-action:pan-x] sm:mx-0 sm:px-0'

export const tableShell =
  'overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800'
export const tableEl = 'w-full text-sm'
// 表头需与表体（bg-white / dark:bg-neutral-900）形成对比：
// 深色下用略亮的表面 + 底部分隔线，避免表头与表体同色而“看不见表头”。
export const tableHead =
  'border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-400'
export const tableBody =
  'divide-y divide-neutral-100 bg-white dark:divide-neutral-800 dark:bg-neutral-900'
export const th = 'px-3 py-2.5 text-left font-medium whitespace-nowrap'
export const td = 'px-3 py-2.5 align-middle'
export const tableRowHover = 'transition hover:bg-neutral-50 dark:hover:bg-neutral-800/40'
