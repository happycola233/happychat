import { Outlet } from 'react-router-dom'
import { useConversationEvents } from '../sse/conversationEvents'
import { AnnouncementDialog } from '../announcements/AnnouncementDialog'
import { Sidebar } from './Sidebar'
import { SettingsDialog } from './SettingsDialog'

export default function ChatLayout() {
  useConversationEvents()

  return (
    <div className="flex h-full overflow-hidden bg-white dark:bg-[#000000]">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
      <SettingsDialog />
      <AnnouncementDialog />
    </div>
  )
}
