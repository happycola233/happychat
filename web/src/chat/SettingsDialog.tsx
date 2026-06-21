import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listMyShares, revokeConversationShare } from '../api/shares'
import {
  Info,
  MessageSquareText,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react'
import type {
  MessageFontSize,
  MessageTimeFormat,
  ThemePreference,
  UserPreferences,
} from '@shared/types/domain'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'
import { Toggle } from '../components/ui/Toggle'
import { useMe } from '../hooks/useAuth'
import {
  useChangePassword,
  useClearConversations,
  useDeleteAccount,
  useRemoveAvatar,
  useUpdateProfile,
  useUploadAvatar,
} from '../hooks/useSettings'
import { useSettings } from '../store/settings'
import { useSettingsDialog, type SettingsTab } from '../store/settingsDialog'
import { toast } from '../store/toast'

const APP_VERSION = '0.1.0'
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/

const TABS: { id: SettingsTab; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'general', label: '通用', icon: SlidersHorizontal },
  { id: 'messages', label: '消息显示', icon: MessageSquareText },
  { id: 'account', label: '账户', icon: UserRound },
  { id: 'about', label: '关于', icon: Info },
]

/** 仅取布尔类型的偏好键，供开关行复用。 */
type BooleanPrefKey = {
  [K in keyof UserPreferences]: UserPreferences[K] extends boolean ? K : never
}[keyof UserPreferences]

function Row({ title, desc, control }: { title: string; desc?: ReactNode; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-5 py-3.5">
      <div className="min-w-0">
        <div className="text-[14px] text-neutral-900 dark:text-neutral-100">{title}</div>
        {desc && (
          <div className="mt-0.5 text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">
            {desc}
          </div>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-md px-3 py-1.5 text-[13px] font-medium transition',
            value === o.value
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-white'
              : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function PrefToggleRow({
  prefKey,
  title,
  desc,
}: {
  prefKey: BooleanPrefKey
  title: string
  desc?: ReactNode
}) {
  const checked = useSettings((s) => s.preferences[prefKey])
  const setPreference = useSettings((s) => s.setPreference)
  return <Row title={title} desc={desc} control={<Toggle checked={checked} onChange={(v) => setPreference(prefKey, v)} />} />
}

function GeneralPanel() {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const fontSize = useSettings((s) => s.preferences.messageFontSize)
  const setPreference = useSettings((s) => s.setPreference)

  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      <Row
        title="主题"
        control={
          <Segmented<ThemePreference>
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
              { value: 'system', label: '跟随系统' },
            ]}
          />
        }
      />
      <Row
        title="消息字体大小"
        control={
          <Segmented<MessageFontSize>
            value={fontSize}
            onChange={(v) => setPreference('messageFontSize', v)}
            options={[
              { value: 'small', label: '小' },
              { value: 'medium', label: '中' },
              { value: 'large', label: '大' },
            ]}
          />
        }
      />
      <PrefToggleRow
        prefKey="sendOnEnter"
        title="按 Enter 发送消息"
        desc="开启后按 Enter 发送、Shift+Enter 换行；关闭后按 Enter 换行，需 Ctrl/⌘+Enter 发送。"
      />
      <PrefToggleRow prefKey="autoScrollOnOpen" title="打开对话时自动滚动到最新" />
      <PrefToggleRow prefKey="showScrollToBottom" title="显示「滚动到底部」按钮" />
      <PrefToggleRow
        prefKey="defaultExpandReasoning"
        title="默认展开推理摘要"
        desc="关闭时生成完成后自动折叠推理过程。"
      />
    </div>
  )
}

function MessagesPanel() {
  const showMessageTime = useSettings((s) => s.preferences.showMessageTime)
  const messageTimeFormat = useSettings((s) => s.preferences.messageTimeFormat)
  const setPreference = useSettings((s) => s.setPreference)
  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      <PrefToggleRow prefKey="showMessageTime" title="显示消息时间" desc="在每条消息旁显示发送/生成时间。" />
      {showMessageTime && (
        <Row
          title="时间格式"
          control={
            <Segmented<MessageTimeFormat>
              value={messageTimeFormat}
              onChange={(v) => setPreference('messageTimeFormat', v)}
              options={[
                { value: 'time', label: '仅时间' },
                { value: 'datetime', label: '日期+时间' },
              ]}
            />
          }
        />
      )}
      <PrefToggleRow prefKey="showModelLabel" title="在助手消息显示模型名称" />
      <PrefToggleRow
        prefKey="showUsageStats"
        title="显示用量明细"
        desc="在助手消息下方显示 Token、生成速度（tok/s）与耗时。"
      />
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wide text-neutral-400">
      {children}
    </h4>
  )
}

function MySharesSection() {
  const qc = useQueryClient()
  const { data: shares } = useQuery({ queryKey: ['my-shares'], queryFn: listMyShares })
  const revoke = useMutation({
    mutationFn: (conversationId: string) => revokeConversationShare(conversationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-shares'] })
      toast.success('已停止分享')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })
  return (
    <>
      <SectionTitle>我的分享</SectionTitle>
      {!shares?.length ? (
        <p className="text-sm text-neutral-400">还没有分享的聊天。</p>
      ) : (
        <div className="space-y-2">
          {shares.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 dark:border-neutral-800"
            >
              <a
                href={`/s/${s.token}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-sm text-neutral-700 hover:underline dark:text-neutral-200"
              >
                {s.title ?? '（无标题）'}
              </a>
              <span className="shrink-0 text-xs text-neutral-400">
                {s.expiresAt ? '有期限' : '永久'}
              </span>
              <button
                onClick={() => revoke.mutate(s.conversationId)}
                className="shrink-0 text-xs text-red-500 hover:text-red-600"
              >
                停止
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function AccountPanel() {
  const navigate = useNavigate()
  const me = useMe().data
  const uploadAvatar = useUploadAvatar()
  const removeAvatar = useRemoveAvatar()
  const updateProfile = useUpdateProfile()
  const changePassword = useChangePassword()
  const clearConversations = useClearConversations()
  const deleteAccount = useDeleteAccount()
  const fileRef = useRef<HTMLInputElement>(null)

  const [username, setUsername] = useState(me?.username ?? '')
  const [displayName, setDisplayName] = useState(me?.displayName ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')

  useEffect(() => {
    setUsername(me?.username ?? '')
    setDisplayName(me?.displayName ?? '')
  }, [me?.displayName, me?.username])

  const trimmedUsername = username.trim()
  const trimmedDisplayName = displayName.trim()
  const usernameError =
    trimmedUsername && !USERNAME_PATTERN.test(trimmedUsername)
      ? '只能包含字母、数字、下划线、点和短横线'
      : undefined
  const profileChanged =
    trimmedUsername !== (me?.username ?? '') || trimmedDisplayName !== (me?.displayName ?? '')
  const canSaveProfile = Boolean(trimmedUsername) && !usernameError && profileChanged

  const onPickAvatar = (file: File | undefined) => {
    if (!file) return
    uploadAvatar.mutate(file, {
      onSuccess: () => toast.success('头像已更新'),
      onError: (e) => toast.error(e instanceof Error ? e.message : '上传失败'),
    })
  }

  const onSaveProfile = () => {
    if (!trimmedUsername) {
      toast.error('请输入用户名')
      return
    }
    updateProfile.mutate(
      { username: trimmedUsername, displayName: trimmedDisplayName || null },
      {
        onSuccess: () => toast.success('已保存'),
        onError: (e) => toast.error(e instanceof Error ? e.message : '保存失败'),
      },
    )
  }

  const onChangePassword = () => {
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          toast.success('密码已更新')
          setCurrentPassword('')
          setNewPassword('')
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : '修改失败'),
      },
    )
  }

  const onClearAll = () => {
    clearConversations.mutate(undefined, {
      onSuccess: (count) => {
        toast.success(`已清除 ${count} 个对话`)
        setConfirmClear(false)
        navigate('/')
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : '清除失败'),
    })
  }

  const onDeleteAccount = () => {
    deleteAccount.mutate(
      { password: deletePassword },
      {
        onSuccess: () => {
          toast.success('账户已删除')
          navigate('/login')
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
      },
    )
  }

  const avatarInitial = (me?.displayName ?? me?.username ?? 'U').slice(0, 1).toLocaleUpperCase()

  return (
    <div className="pb-4">
      <SectionTitle>个人资料</SectionTitle>
      <div className="flex items-center gap-4 py-2">
        {me?.avatarUrl ? (
          <img
            src={me.avatarUrl}
            alt="头像"
            className="h-16 w-16 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-sky-300 via-indigo-300 to-fuchsia-300 text-xl font-semibold text-white">
            {avatarInitial}
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              onPickAvatar(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Button
            variant="secondary"
            loading={uploadAvatar.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            上传头像
          </Button>
          {me?.avatarUrl && (
            <Button
              variant="ghost"
              loading={removeAvatar.isPending}
              onClick={() =>
                removeAvatar.mutate(undefined, {
                  onSuccess: () => toast.success('已移除头像'),
                })
              }
            >
              移除
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="用户名"
            value={username}
            maxLength={32}
            autoComplete="username"
            error={usernameError}
            hint="用于登录"
            onChange={(e) => setUsername(e.target.value)}
          />
          <TextField
            label="显示名称"
            value={displayName}
            maxLength={48}
            placeholder={me?.username ?? ''}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button
            variant="secondary"
            loading={updateProfile.isPending}
            disabled={!canSaveProfile}
            onClick={onSaveProfile}
          >
            保存资料
          </Button>
        </div>
      </div>

      <SectionTitle>更换密码</SectionTitle>
      <div className="space-y-2.5">
        <TextField
          type="password"
          label="当前密码"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <TextField
          type="password"
          label="新密码"
          autoComplete="new-password"
          hint="至少 6 位"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            loading={changePassword.isPending}
            disabled={currentPassword.length < 1 || newPassword.length < 6}
            onClick={onChangePassword}
          >
            更新密码
          </Button>
        </div>
        <p className="text-[12px] text-neutral-400">更新密码后，其它设备上的登录将全部失效。</p>
      </div>

      <MySharesSection />

      <SectionTitle>危险操作</SectionTitle>
      <div className="space-y-3 rounded-xl border border-red-200 p-4 dark:border-red-900/40">
        {/* 清除所有对话 */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[14px] text-neutral-900 dark:text-neutral-100">清除所有对话</div>
            <div className="text-[12px] text-neutral-500 dark:text-neutral-400">删除你的全部对话与附件，不可恢复。</div>
          </div>
          {confirmClear ? (
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                取消
              </Button>
              <Button variant="danger" loading={clearConversations.isPending} onClick={onClearAll}>
                确认清除
              </Button>
            </div>
          ) : (
            <Button variant="secondary" className="shrink-0" onClick={() => setConfirmClear(true)}>
              <Trash2 className="h-4 w-4" />
              清除
            </Button>
          )}
        </div>

        <div className="border-t border-red-100 dark:border-red-900/30" />

        {/* 删除账户 */}
        <div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[14px] text-neutral-900 dark:text-neutral-100">删除账户</div>
              <div className="text-[12px] text-neutral-500 dark:text-neutral-400">永久删除账户及其全部数据，不可恢复。</div>
            </div>
            {!confirmDelete && (
              <Button variant="danger" className="shrink-0" onClick={() => setConfirmDelete(true)}>
                删除账户
              </Button>
            )}
          </div>
          {confirmDelete && (
            <div className="mt-3 space-y-2.5">
              <TextField
                type="password"
                label="输入密码以确认"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConfirmDelete(false)
                    setDeletePassword('')
                  }}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  loading={deleteAccount.isPending}
                  disabled={deletePassword.length < 1}
                  onClick={onDeleteAccount}
                >
                  永久删除
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AboutPanel() {
  return (
    <div className="py-2">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-lg font-semibold text-white dark:bg-white dark:text-neutral-900">
          H
        </span>
        <div>
          <div className="text-[16px] font-semibold text-neutral-900 dark:text-neutral-100">HappyChat</div>
          <div className="text-[12px] text-neutral-400">版本 {APP_VERSION}</div>
        </div>
      </div>
      <p className="mt-4 text-[13px] leading-6 text-neutral-600 dark:text-neutral-300">
        一个私有的 AI 聊天站，服务端代理上游模型并把结果流式返回浏览器。仅供自用与少数朋友使用。
      </p>
      <a
        href="https://github.com/happycola233/happychat"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block text-[13px] text-sky-600 hover:underline dark:text-sky-400"
      >
        GitHub 仓库
      </a>
    </div>
  )
}

export function SettingsDialog() {
  const { open, tab, closeDialog, setTab } = useSettingsDialog()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDialog()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeDialog])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center sm:p-4" data-testid="settings-dialog">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeDialog} />
      <div className="hc-pop-in relative z-10 flex h-full w-full flex-col overflow-hidden bg-white dark:bg-neutral-900 sm:h-[640px] sm:max-h-[88vh] sm:max-w-3xl sm:rounded-2xl sm:shadow-xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h3 className="text-[17px] font-semibold text-neutral-900 dark:text-neutral-100">设置</h3>
          <button
            type="button"
            onClick={closeDialog}
            className="rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* 标签导航：桌面左侧竖排 / 移动端顶部横排 */}
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-neutral-200 px-3 py-2 dark:border-neutral-800 sm:w-48 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
            {TABS.map((t) => {
              const Icon = t.icon
              const active = t.id === tab
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-[14px] transition',
                    active
                      ? 'bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white'
                      : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  {t.label}
                </button>
              )
            })}
          </nav>

          {/* 内容 */}
          <div className="hc-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-1 sm:px-6">
            {tab === 'general' && <GeneralPanel />}
            {tab === 'messages' && <MessagesPanel />}
            {tab === 'account' && <AccountPanel />}
            {tab === 'about' && <AboutPanel />}
          </div>
        </div>
      </div>
    </div>
  )
}
