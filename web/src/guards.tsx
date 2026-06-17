import { Navigate, Outlet } from 'react-router-dom'
import { useMe } from './hooks/useAuth'
import { FullScreenLoader } from './components/ui/Spinner'

export function RequireAuth() {
  const { data: user, isLoading } = useMe()
  if (isLoading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

export function RequireAdmin() {
  const { data: user, isLoading } = useMe()
  if (isLoading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}

export function RedirectIfAuthed() {
  const { data: user, isLoading } = useMe()
  if (isLoading) return <FullScreenLoader />
  if (user) return <Navigate to="/" replace />
  return <Outlet />
}
