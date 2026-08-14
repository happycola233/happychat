import { lazy } from 'react'

// 个人使用情况面板懒加载：热力图与统计只在用户主动打开时才进包，不拖累聊天首屏。
// 与 `pages/admin/lazyPages.ts` 同一模式——懒加载声明单独成文件，
// 避免与 `router.tsx` 的非组件导出混在一起破坏 Fast Refresh。
export const UsagePage = lazy(() => import('./UsagePage'))
