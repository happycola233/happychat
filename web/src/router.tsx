import { Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RedirectIfAuthed, RequireAdmin, RequireAuth, RequirePasswordChange } from './guards'
import { Spinner } from './components/ui/Spinner'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ChangePasswordRequiredPage from './pages/ChangePasswordRequiredPage'
import ChatLayout from './chat/ChatLayout'
import ChatView from './chat/ChatView'
import SharedChatPage from './pages/SharedChatPage'
import { UsagePage } from './pages/lazyPages'
import AdminLayout from './pages/admin/AdminLayout'
import {
  AnalyticsPage,
  AnnouncementsPage,
  AuthCenterPage,
  ErrorEventsPage,
  ModelsPage,
  ModelGroupsPage,
  OverviewPage,
  ProvidersPage,
  QuotasPage,
  RequestEventsPage,
  SettingsPage,
  SharesPage,
  UserDetailPage,
} from './pages/admin/lazyPages'

export const router = createBrowserRouter([
  {
    element: <RequireAuth />,
    children: [
      {
        element: <ChatLayout />,
        children: [
          { path: '/', element: <ChatView /> },
          { path: '/c/:id', element: <ChatView /> },
        ],
      },
      {
        path: '/usage',
        element: (
          <Suspense
            fallback={
              <div className="flex h-dvh items-center justify-center">
                <Spinner className="h-6 w-6 text-neutral-400" />
              </div>
            }
          >
            <UsagePage />
          </Suspense>
        ),
      },
    ],
  },
  {
    element: <RequireAdmin />,
    children: [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <Navigate to="overview" replace /> },
          { path: 'overview', element: <OverviewPage /> },
          { path: 'analytics', element: <AnalyticsPage /> },
          { path: 'request-events', element: <RequestEventsPage /> },
          { path: 'error-logs', element: <ErrorEventsPage /> },
          { path: 'auth-center', element: <AuthCenterPage /> },
          { path: 'shares', element: <SharesPage /> },
          { path: 'quotas', element: <QuotasPage /> },
          { path: 'users/:id', element: <UserDetailPage /> },
          { path: 'providers', element: <ProvidersPage /> },
          { path: 'models', element: <ModelsPage /> },
          { path: 'model-groups', element: <ModelGroupsPage /> },
          { path: 'announcements', element: <AnnouncementsPage /> },
          { path: 'settings', element: <SettingsPage /> },
          // 旧路径兼容重定向
          { path: 'stats', element: <Navigate to="/admin/overview" replace /> },
          { path: 'users', element: <Navigate to="/admin/auth-center" replace /> },
          { path: 'invites', element: <Navigate to="/admin/auth-center" replace /> },
          { path: 'logs', element: <Navigate to="/admin/error-logs" replace /> },
        ],
      },
    ],
  },
  {
    element: <RequirePasswordChange />,
    children: [{ path: '/change-password', element: <ChangePasswordRequiredPage /> }],
  },
  {
    element: <RedirectIfAuthed />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  // 公开只读分享页（无需登录）
  { path: '/s/:token', element: <SharedChatPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
])
