import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listMyShares, revokeConversationShare } from '../api/shares'
import {
  Camera,
  Check,
  ChevronDown,
  Info,
  MessageSquareText,
  Share2,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react'
import type {
  AccentColor,
  MessageFontSize,
  MessageTimeFormat,
  ThemePreference,
  UserPreferences,
} from '@shared/types/domain'
import { useIsDark } from '../lib/useIsDark'
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
import { copyToClipboard } from '../lib/clipboard'
import { formatDateTime } from '../lib/format'
import { AvatarCropDialog } from './AvatarCropDialog'
import { CopyIcon, DeleteIcon, ExternalLinkIcon } from './icons'

const APP_VERSION = '0.1.0'
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/

const ACCENT_OPTIONS = [
  { value: 'default', label: '默认', light: '#b4b4b4', dark: '#9b9b9b' },
  { value: 'blue', label: '蓝色', light: '#3a83f7', dark: '#2c67c5' },
  { value: 'green', label: '绿色', light: '#53b559', dark: '#48a04c' },
  { value: 'yellow', label: '黄色', light: '#f6c543', dark: '#d9a337' },
  { value: 'pink', label: '粉色', light: '#e0766d', dark: '#c96257' },
  { value: 'orange', label: '橙色', light: '#ee7c37', dark: '#d25e28' },
  { value: 'purple', label: '紫色', light: '#8952ee', dark: '#7849d1' },
] as const satisfies readonly {
  value: AccentColor
  label: string
  light: string
  dark: string
}[]

const TABS: { id: SettingsTab; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'general', label: '通用', icon: SlidersHorizontal },
  { id: 'messages', label: '消息显示', icon: MessageSquareText },
  { id: 'account', label: '账户', icon: UserRound },
  { id: 'shares', label: '我的分享', icon: Share2 },
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

type SelectOption<T extends string> = {
  value: T
  label: string
}

function PreferenceSelect<
  T extends string,
  TOption extends SelectOption<T> = SelectOption<T>,
>({
  value,
  options,
  onChange,
  menuClassName = 'w-56',
  leading,
}: {
  value: T
  options: readonly TOption[]
  onChange: (v: T) => void
  menuClassName?: string
  leading?: (option: TOption) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!selected) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[14px] font-medium text-neutral-800 transition hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800',
          open && 'bg-neutral-100 dark:bg-neutral-800',
        )}
      >
        {leading?.(selected)}
        <span>{selected.label}</span>
        <ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="menu"
          className={clsx(
            'hc-pop-in absolute right-0 top-full z-40 mt-2 rounded-2xl border border-black/10 bg-white p-1.5 text-neutral-900 shadow-[0_18px_45px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#303030] dark:text-neutral-100 dark:shadow-[0_18px_45px_rgba(0,0,0,0.45)]',
            menuClassName,
          )}
        >
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={clsx(
                  'flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium transition hover:bg-neutral-100 dark:hover:bg-white/10',
                  active && 'bg-neutral-100 dark:bg-white/10',
                )}
              >
                {leading?.(option)}
                <span className="min-w-0 flex-1">{option.label}</span>
                {active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AccentColorSelect() {
  const value = useSettings((s) => s.preferences.accentColor)
  const setPreference = useSettings((s) => s.setPreference)
  const isDark = useIsDark()
  const swatchOf = (option: (typeof ACCENT_OPTIONS)[number]) =>
    isDark ? option.dark : option.light

  return (
    <PreferenceSelect
      value={value}
      onChange={(v) => setPreference('accentColor', v)}
      options={ACCENT_OPTIONS}
      menuClassName="w-64"
      leading={(option) => (
        <span
          className="h-3.5 w-3.5 rounded-full"
          style={{ backgroundColor: swatchOf(option) }}
        />
      )}
    />
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

  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      <Row
        title="主题"
        control={
          <PreferenceSelect<ThemePreference>
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
          />
        }
      />
      <Row title="重点色" control={<AccentColorSelect />} />
      <PrefToggleRow
        prefKey="showNewChatGradientGlow"
        title="启用新聊天渐变光晕背景"
        desc="在桌面端新聊天页输入框后方显示柔和渐变光晕。"
      />
      <PrefToggleRow
        prefKey="sendOnEnterDesktop"
        title="桌面端按 Enter 发送消息"
        desc="开启后按 Enter 发送、Shift+Enter 换行；关闭后按 Enter 换行，需 Ctrl/⌘+Enter 发送。"
      />
      <PrefToggleRow
        prefKey="sendOnEnterMobile"
        title="手机端按 Enter 发送消息"
        desc="默认关闭：按 Enter 换行，点发送按钮发送，更符合手机输入习惯；开启后按 Enter 直接发送。"
      />
      <PrefToggleRow
        prefKey="autoScrollOnOpen"
        title="打开对话时自动滚动到底部"
        desc="开启后，进入或切换对话时直接显示最新消息；关闭后从对话顶部的最早消息开始显示。"
      />
      <PrefToggleRow prefKey="showScrollToBottom" title="显示「滚动到底部」按钮" />
      <PrefToggleRow
        prefKey="showTimelineNav"
        title="消息时间轴导航"
        desc="在聊天右侧显示你发送过的消息列表，悬停查看、点击快速跳转（仅桌面端视图）。"
      />
    </div>
  )
}

function MessagesPanel() {
  const fontSize = useSettings((s) => s.preferences.messageFontSize)
  const showMessageTime = useSettings((s) => s.preferences.showMessageTime)
  const messageTimeFormat = useSettings((s) => s.preferences.messageTimeFormat)
  const setPreference = useSettings((s) => s.setPreference)
  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      <Row
        title="消息字体大小"
        control={
          <PreferenceSelect<MessageFontSize>
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
      <PrefToggleRow prefKey="showMessageTime" title="显示消息时间" desc="在每条消息旁显示发送/生成时间。" />
      {showMessageTime && (
        <Row
          title="时间格式"
          control={
            <PreferenceSelect<MessageTimeFormat>
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
        desc="在助手消息下方显示 Token（含缓存写入/读取）、生成速度（tok/s）与耗时。"
      />
      <PrefToggleRow
        prefKey="defaultExpandReasoning"
        title="默认展开推理摘要"
        desc="关闭后推理摘要将默认保持折叠。"
      />
    </div>
  )
}

/** 设置面板内的分区卡片：标题 + 说明 + 内容，账户/分享页共用。 */
function SectionCard({
  title,
  description,
  danger,
  children,
}: {
  title: string
  description?: ReactNode
  danger?: boolean
  children: ReactNode
}) {
  return (
    <section
      className={clsx(
        'rounded-2xl border p-4',
        danger
          ? 'border-red-200 dark:border-red-900/40'
          : 'border-neutral-200 dark:border-neutral-800',
      )}
    >
      <h4 className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-100">{title}</h4>
      {description && (
        <p className="mt-0.5 text-[12px] leading-5 text-neutral-400 dark:text-neutral-500">
          {description}
        </p>
      )}
      <div className="mt-3.5">{children}</div>
    </section>
  )
}

/** 「我的分享」独立页：链接可复制/打开，可随时停止分享。 */
function SharesPanel() {
  const qc = useQueryClient()
  const { data: shares, isLoading } = useQuery({ queryKey: ['my-shares'], queryFn: listMyShares })
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const revoke = useMutation({
    mutationFn: (conversationId: string) => revokeConversationShare(conversationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-shares'] })
      toast.success('已停止分享')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })

  const copyLink = (id: string, token: string) => {
    void copyToClipboard(`${window.location.origin}/s/${token}`).then((ok) => {
      if (!ok) {
        toast.error('复制失败')
        return
      }
      setCopiedId(id)
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
    })
  }

  const active = (shares ?? []).filter((s) => !s.revoked)

  return (
    <div className="py-4">
      <p className="text-[12px] leading-5 text-neutral-400 dark:text-neutral-500">
        分享链接是创建时的快照，对方无需登录即可查看；停止分享后链接立即失效。
      </p>
      {isLoading ? null : active.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 py-10 text-center">
          <Share2 className="h-7 w-7 text-neutral-300 dark:text-neutral-600" />
          <p className="text-sm text-neutral-400">还没有分享的聊天</p>
          <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
            在会话右上角的「⋯」菜单里选择「分享」即可创建链接。
          </p>
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {active.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-neutral-800 dark:text-neutral-100">
                    {s.title ?? '（无标题）'}
                  </div>
                  <div className="mt-0.5 text-[12px] text-neutral-400">
                    {formatDateTime(s.createdAt)} ·{' '}
                    {s.expiresAt ? `${formatDateTime(s.expiresAt)} 过期` : '永久有效'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyLink(s.id, s.token)}
                  aria-label="复制链接"
                  title="复制链接"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                >
                  {copiedId === s.id ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <CopyIcon className="h-4 w-4" />
                  )}
                </button>
                <a
                  href={`/s/${s.token}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="打开分享页"
                  title="打开分享页"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                >
                  <ExternalLinkIcon className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={() => revoke.mutate(s.conversationId)}
                  className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-red-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                >
                  停止分享
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
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
  // 待裁切图片的 object URL：选择文件后打开裁切对话框，上传/取消后回收。
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)

  useEffect(() => {
    setUsername(me?.username ?? '')
    setDisplayName(me?.displayName ?? '')
  }, [me?.displayName, me?.username])

  // 关闭裁切（或组件卸载）时释放 object URL。
  useEffect(() => {
    if (!cropImageSrc) return
    return () => URL.revokeObjectURL(cropImageSrc)
  }, [cropImageSrc])

  const trimmedUsername = username.trim()
  const trimmedDisplayName = displayName.trim()
  const usernameError =
    trimmedUsername && !USERNAME_PATTERN.test(trimmedUsername)
      ? '只能包含字母、数字、下划线、点和短横线'
      : undefined
  const profileChanged =
    trimmedUsername !== (me?.username ?? '') || trimmedDisplayName !== (me?.displayName ?? '')
  const canSaveProfile = Boolean(trimmedUsername) && !usernameError && profileChanged

  // 选择文件 → 先进入裁切，而不是直接上传。
  const onPickAvatar = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件')
      return
    }
    setCropImageSrc(URL.createObjectURL(file))
  }

  const onCropConfirm = (file: File) => {
    uploadAvatar.mutate(file, {
      onSuccess: () => {
        toast.success('头像已更新')
        setCropImageSrc(null)
      },
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
    <div className="space-y-4 py-4">
      <SectionCard title="个人资料">
        <div className="flex items-center gap-4">
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
          {/* 头像即入口：点击选图进入裁切，悬停浮现相机遮罩提示可更换。 */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="更换头像"
            title="更换头像"
            className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900"
          >
            {me?.avatarUrl ? (
              <img src={me.avatarUrl} alt="头像" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-sky-300 via-indigo-300 to-fuchsia-300 text-xl font-semibold text-white">
                {avatarInitial}
              </span>
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Camera className="h-5 w-5 text-white" />
            </span>
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                className="!px-2.5 !py-1.5 text-xs"
                onClick={() => fileRef.current?.click()}
              >
                更换头像
              </Button>
              {me?.avatarUrl && (
                <Button
                  variant="ghost"
                  className="!px-2.5 !py-1.5 text-xs"
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
            <p className="mt-1.5 text-[12px] text-neutral-400">
              支持 PNG / JPG / WebP，上传前可裁切合适的区域。
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
            hint="展示给自己与分享页"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            className="!px-3 !py-1.5 text-xs"
            loading={updateProfile.isPending}
            disabled={!canSaveProfile}
            onClick={onSaveProfile}
          >
            保存资料
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="更换密码" description="更新密码后，其它设备上的登录将全部失效。">
        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            variant="secondary"
            className="!px-3 !py-1.5 text-xs"
            loading={changePassword.isPending}
            disabled={currentPassword.length < 1 || newPassword.length < 6}
            onClick={onChangePassword}
          >
            更新密码
          </Button>
        </div>
      </SectionCard>

      {cropImageSrc && (
        <AvatarCropDialog
          imageSrc={cropImageSrc}
          uploading={uploadAvatar.isPending}
          onCancel={() => setCropImageSrc(null)}
          onConfirm={onCropConfirm}
        />
      )}

      <SectionCard title="危险操作" danger>
        <div className="space-y-3">
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
              <DeleteIcon className="h-4 w-4" />
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
      </SectionCard>
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
        一个开源、可自托管的 AI 聊天站。
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
            {tab === 'shares' && <SharesPanel />}
            {tab === 'about' && <AboutPanel />}
          </div>
        </div>
      </div>
    </div>
  )
}
