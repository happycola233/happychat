import { lazy } from 'react'

// 管理后台页面（含 recharts）按需懒加载，避免拖累聊天主包体积。
export const OverviewPage = lazy(() => import('./OverviewPage'))
export const AnalyticsPage = lazy(() => import('./AnalyticsPage'))
export const RequestEventsPage = lazy(() => import('./RequestEventsPage'))
export const ErrorEventsPage = lazy(() => import('./ErrorEventsPage'))
export const AuthCenterPage = lazy(() => import('./AuthCenterPage'))
export const UserDetailPage = lazy(() => import('./UserDetailPage'))
export const SharesPage = lazy(() => import('./SharesPage'))
export const ProvidersPage = lazy(() => import('./ProvidersPage'))
export const ModelsPage = lazy(() => import('./ModelsPage'))
export const AnnouncementsPage = lazy(() => import('./AnnouncementsPage'))
export const SettingsPage = lazy(() => import('./SettingsPage'))
