import { Outlet } from 'react-router-dom'
import { useConversationEvents } from '../sse/conversationEvents'
import { AnnouncementDialog } from '../announcements/AnnouncementDialog'
import { Sidebar } from './Sidebar'
import { SettingsDialog } from './SettingsDialog'

export default function ChatLayout() {
  useConversationEvents()

  return (
    <div className="flex h-full bg-white dark:bg-[#000000]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
      <SettingsDialog />
      <AnnouncementDialog />
    </div>
  )
}
