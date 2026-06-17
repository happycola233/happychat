import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RedirectIfAuthed, RequireAdmin, RequireAuth } from './guards'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ChatLayout from './chat/ChatLayout'
import ChatView from './chat/ChatView'
import AdminLayout from './pages/admin/AdminLayout'
import ProvidersPage from './pages/admin/ProvidersPage'
import ModelsPage from './pages/admin/ModelsPage'
import StatsPage from './pages/admin/StatsPage'
import UsersPage from './pages/admin/UsersPage'
import InvitesPage from './pages/admin/InvitesPage'
import LogsPage from './pages/admin/LogsPage'
import SettingsPage from './pages/admin/SettingsPage'

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
    ],
  },
  {
    element: <RequireAdmin />,
    children: [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <Navigate to="stats" replace /> },
          { path: 'stats', element: <StatsPage /> },
          { path: 'providers', element: <ProvidersPage /> },
          { path: 'models', element: <ModelsPage /> },
          { path: 'users', element: <UsersPage /> },
          { path: 'invites', element: <InvitesPage /> },
          { path: 'logs', element: <LogsPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
  {
    element: <RedirectIfAuthed />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
