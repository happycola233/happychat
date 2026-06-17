import { clsx } from 'clsx'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, Monitor, Moon, Plus, Settings, Sun, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteConversation } from '../api/chat'
import { useConversations } from '../hooks/useConversations'
import { useLogout, useMe } from '../hooks/useAuth'
import { toast } from '../store/toast'
import { useTheme } from '../store/theme'

export function Sidebar() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: user } = useMe()
  const { data: conversations } = useConversations()
  const logout = useLogout()
  const { theme, setTheme } = useTheme()
  const cycleTheme = () =>
    setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  const remove = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_r, deletedId) => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      if (deletedId === id) navigate('/')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="p-3">
        <button
          onClick={() => navigate('/')}
          className="flex w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-medium text-neutral-800 transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          <Plus className="h-4 w-4" /> 新对话
        </button>
      </div>

      <nav className="hc-scrollbar flex-1 overflow-y-auto px-2">
        {conversations?.length ? (
          <ul className="space-y-0.5">
            {conversations.map((c) => (
              <li key={c.id}>
                <div
                  className={clsx(
                    'group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition',
                    c.id === id
                      ? 'bg-neutral-200/70 dark:bg-neutral-800'
                      : 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60',
                  )}
                >
                  <button
                    onClick={() => navigate(`/c/${c.id}`)}
                    className="min-w-0 flex-1 truncate text-left text-neutral-700 dark:text-neutral-200"
                    title={c.title ?? '新对话'}
                  >
                    {c.title ?? '新对话'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('确定删除该会话？')) remove.mutate(c.id)
                    }}
                    className="opacity-0 transition group-hover:opacity-100"
                    aria-label="删除会话"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-neutral-400 hover:text-red-500" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-xs text-neutral-400">还没有会话</p>
        )}
      </nav>

      <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
        <div className="mb-2 px-1 text-xs text-neutral-400">
          {user?.displayName ?? user?.username}
          {user?.role === 'admin' && ' · 管理员'}
        </div>
        <div className="flex items-center gap-1">
          {user?.role === 'admin' && (
            <Link
              to="/admin"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs text-neutral-600 transition hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Settings className="h-3.5 w-3.5" /> 管理
            </Link>
          )}
          <button
            onClick={() => logout.mutate()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs text-neutral-600 transition hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <LogOut className="h-3.5 w-3.5" /> 退出
          </button>
          <button
            onClick={cycleTheme}
            className="rounded-lg p-2 text-neutral-600 transition hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title={`主题：${theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}`}
            aria-label="切换主题"
          >
            <ThemeIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
