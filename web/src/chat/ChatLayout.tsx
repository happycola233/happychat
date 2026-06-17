import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export default function ChatLayout() {
  return (
    <div className="flex h-full bg-white dark:bg-neutral-900">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  )
}
