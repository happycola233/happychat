import { Navigate, Outlet } from 'react-router-dom'
import { useMe } from './hooks/useAuth'
import { FullScreenLoader } from './components/ui/Spinner'

export function RequireAuth() {
  const { data: user, isLoading } = useMe()
  if (isLoading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />
  return <Outlet />
}

export function RequireAdmin() {
  const { data: user, isLoading } = useMe()
  if (isLoading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}

export function RequirePasswordChange() {
  const { data: user, isLoading } = useMe()
  if (isLoading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace />
  if (!user.mustChangePassword) return <Navigate to="/" replace />
  return <Outlet />
}

export function RedirectIfAuthed() {
  const { data: user, isLoading } = useMe()
  if (isLoading) return <FullScreenLoader />
  if (user) {
    return <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace />
  }
  return <Outlet />
}
