// 统一的表格样式类，保证各管理页表格深浅色一致。

/**
 * 宽表的横向滚动容器：窄屏贴边（-mx-4 + px-4）以获得完整可视宽度，
 * sm 及以上恢复常规内边距。配合内层 `tableShell + min-w-[...]` 使用，
 * 让列不足时横向滚动而非被挤压。这里不要限制 touch-action 为 pan-x，
 * 否则移动端从表格区域起手的纵向拖动不会传给页面滚动容器。
 */
export const tableScroll =
  'hc-scrollbar -mx-4 overflow-x-auto overscroll-x-contain px-4 pb-1 sm:mx-0 sm:px-0'

export const tableShell = 'overflow-hidden rounded-xl'
export const tableEl = 'w-full text-sm'
// 表头以浅底色和小字号区分层次，不额外叠加边框；各页面复用，避免出现独立样式。
export const tableHead =
  'bg-neutral-50 text-xs text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-400'
export const tableBody = 'divide-y divide-neutral-100 dark:divide-neutral-800/60'
export const th = 'px-3.5 py-2.5 text-left font-medium whitespace-nowrap'
export const td = 'px-3.5 py-2.5 align-middle'
export const tableRowHover = 'transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-800/40'

// 运营列表在窄屏重排为有标签的双列记录；表头与数据仍共用同一份语义化表格。
export const responsiveTable = `${tableEl} block lg:table`
export const responsiveTableHead = `${tableHead} hidden lg:table-header-group`
export const responsiveTableBody =
  'grid gap-3 md:grid-cols-2 lg:table-row-group lg:divide-y lg:divide-neutral-100 dark:lg:divide-neutral-800/60'
export const responsiveTableRow = `${tableRowHover} grid grid-cols-2 rounded-xl bg-neutral-50 p-2 lg:table-row lg:rounded-none lg:bg-transparent lg:p-0 dark:bg-neutral-900/60 dark:lg:bg-transparent`
export const responsiveTd = 'min-w-0 px-2 py-2 align-middle lg:px-3.5 lg:py-2.5'
export const mobileCellLabel = 'mb-1 block text-xs text-neutral-500 dark:text-neutral-400 lg:hidden'
