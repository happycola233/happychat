import { useLayoutEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useConversationEvents } from '../sse/conversationEvents'
import { AnnouncementDialog } from '../announcements/AnnouncementDialog'
import { Sidebar } from './Sidebar'
import { SettingsDialog } from './SettingsDialog'

const CHAT_SHELL_LOCK_CLASS = 'hc-chat-shell-lock'

export default function ChatLayout() {
  useConversationEvents()

  useLayoutEffect(() => {
    document.documentElement.classList.add(CHAT_SHELL_LOCK_CLASS)
    return () => document.documentElement.classList.remove(CHAT_SHELL_LOCK_CLASS)
  }, [])

  return (
    <div className="flex h-full overflow-clip bg-white dark:bg-[#000000]">
      <Sidebar />
      {/* overflow: clip 只裁剪不建滚动容器，避免大段粘贴时浏览器把外壳 scrollTop 推偏。 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip">
        <Outlet />
      </div>
      <SettingsDialog />
      <AnnouncementDialog />
    </div>
  )
}
