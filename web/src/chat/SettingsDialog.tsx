import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { isShareExpired, listMyShares } from '../api/shares'
import {
  Camera,
  Check,
  ChevronDown,
  Info,
  MessageSquareText,
  Share2,
  SlidersHorizontal,
  UserRound,
  UserRoundX,
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
import { SettingsSection } from '../components/ui/SettingsSection'
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
import { formatShortDate } from '../lib/format'
import { Spinner } from '../components/ui/Spinner'
import { ShareDialog } from './ShareDialog'
import { AvatarCropDialog } from './AvatarCropDialog'
import { AboutPanel } from './AboutPanel'
import { HOVER_REVEAL_CLASS } from './rowMenu'
import { CopyIcon, DeleteIcon, ExternalLinkIcon } from './icons'

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/
const AVATAR_ACTION_BUTTON_CLASS =
  '!rounded-lg border !px-2.5 !py-1.5 text-xs shadow-none hover:border-neutral-300 hover:bg-neutral-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/70'

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

function Row({
  title,
  desc,
  control,
  spacing = 'default',
}: {
  title: string
  desc?: ReactNode
  control: ReactNode
  spacing?: 'default' | 'relaxed'
}) {
  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-5',
        spacing === 'relaxed' ? 'py-3.5' : 'py-3',
      )}
    >
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-neutral-800 dark:text-neutral-100">
          {title}
        </div>
        {desc && (
          <div className="mt-0.5 text-[12px] leading-5 text-neutral-400 dark:text-neutral-500">
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

function PreferenceSelect<T extends string, TOption extends SelectOption<T> = SelectOption<T>>({
  value,
  options,
  onChange,
  menuClassName = 'w-56',
  leading,
  ariaLabel,
}: {
  value: T
  options: readonly TOption[]
  onChange: (v: T) => void
  menuClassName?: string
  leading?: (option: TOption) => ReactNode
  ariaLabel: string
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
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          '-my-1 -mr-2.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 dark:focus-visible:ring-neutral-700',
          open && 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100',
        )}
      >
        {leading?.(selected)}
        <span>{selected.label}</span>
        <ChevronDown
          className={clsx(
            'h-4 w-4 text-neutral-400 transition-transform dark:text-neutral-500',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div
          role="menu"
          className={clsx(
            'hc-pop-in absolute right-0 top-full z-40 mt-2 min-w-full rounded-2xl border border-black/10 bg-white p-1.5 text-neutral-900 shadow-[0_18px_45px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#303030] dark:text-neutral-100 dark:shadow-[0_18px_45px_rgba(0,0,0,0.45)]',
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
                  'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition hover:bg-neutral-100 dark:hover:bg-white/10',
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
      ariaLabel="重点色"
      value={value}
      onChange={(v) => setPreference('accentColor', v)}
      options={ACCENT_OPTIONS}
      menuClassName="w-64"
      leading={(option) => (
        <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: swatchOf(option) }} />
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
  return (
    <Row
      title={title}
      desc={desc}
      control={
        <Toggle checked={checked} onChange={(v) => setPreference(prefKey, v)} ariaLabel={title} />
      }
    />
  )
}

function GeneralPanel() {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)

  return (
    <div className="pb-2">
      <SettingsSection title="外观">
        <Row
          title="主题"
          spacing="relaxed"
          control={
            <PreferenceSelect<ThemePreference>
              ariaLabel="主题"
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
        <Row title="重点色" spacing="relaxed" control={<AccentColorSelect />} />
        <PrefToggleRow
          prefKey="showNewChatGradientGlow"
          title="新聊天渐变光晕背景"
          desc="在桌面端新聊天页输入框后方显示柔和渐变光晕。"
        />
      </SettingsSection>

      <SettingsSection title="发送与换行">
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
      </SettingsSection>

      <SettingsSection title="滚动与导航">
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
      </SettingsSection>
    </div>
  )
}

function MessagesPanel() {
  const fontSize = useSettings((s) => s.preferences.messageFontSize)
  const showMessageTime = useSettings((s) => s.preferences.showMessageTime)
  const messageTimeFormat = useSettings((s) => s.preferences.messageTimeFormat)
  const setPreference = useSettings((s) => s.setPreference)
  return (
    <div className="pb-2">
      <SettingsSection title="排版">
        <Row
          title="消息字体大小"
          spacing="relaxed"
          control={
            <PreferenceSelect<MessageFontSize>
              ariaLabel="消息字体大小"
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
      </SettingsSection>

      <SettingsSection title="消息时间">
        <PrefToggleRow
          prefKey="showMessageTime"
          title="显示消息时间"
          desc="在每条消息旁显示发送/生成时间。"
        />
        {showMessageTime && (
          <Row
            title="时间格式"
            spacing="relaxed"
            control={
              <PreferenceSelect<MessageTimeFormat>
                ariaLabel="消息时间格式"
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
      </SettingsSection>

      <SettingsSection title="助手消息">
        <PrefToggleRow prefKey="showModelLabel" title="在助手消息显示模型名称" />
        <PrefToggleRow
          prefKey="showUsageStats"
          title="显示用量明细"
          desc="在助手消息下方显示 Token（含缓存写入/读取）、生成速度（tok/s）与耗时。"
        />
        <PrefToggleRow
          prefKey="defaultExpandReasoning"
          title="生成时展开思考过程"
          desc="开启后生成过程中自动展开思考过程与检索明细，回答开始后自动折叠；关闭则始终保持折叠。"
        />
      </SettingsSection>
    </div>
  )
}

/**
 * 「我的分享」独立页。
 * 每行：点击标题区跳回原对话；右侧提供 复制链接 / 打开分享页 / 分享设置 三个轻量操作，
 * 更新内容、改有效期、停止分享统一收进「分享设置」弹窗（与会话菜单里的分享是同一个），不在行内堆按钮。
 */
function SharesPanel() {
  const navigate = useNavigate()
  const { closeDialog } = useSettingsDialog()
  const { data: shares, isLoading } = useQuery({ queryKey: ['my-shares'], queryFn: listMyShares })
  const [copiedId, setCopiedId] = useState<string | null>(null)
  /** 正在通过分享设置弹窗管理的会话 id */
  const [managedId, setManagedId] = useState<string | null>(null)

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

  const openConversation = (conversationId: string) => {
    closeDialog()
    navigate(`/c/${conversationId}`)
  }

  const active = (shares ?? []).filter((s) => !s.revoked)
  const iconButtonClass =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-200/60 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-200 dark:focus-visible:ring-neutral-700'

  return (
    <div className="pb-4 pt-1">
      <p className="text-[12px] leading-5 text-neutral-400 dark:text-neutral-500">
        分享链接是创建时定格的快照，对方无需登录即可查看；在「分享设置」中可更新内容、调整有效期或停止分享。
      </p>
      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner className="h-5 w-5 text-neutral-400" />
        </div>
      ) : active.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-200 py-12 text-center dark:border-neutral-800">
          <Share2 className="h-7 w-7 text-neutral-300 dark:text-neutral-600" />
          <p className="text-sm text-neutral-400">还没有分享的聊天</p>
          <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
            在会话右上角的「⋯」菜单里选择「分享」即可创建链接。
          </p>
        </div>
      ) : (
        <>
          <div className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
            {active.map((s) => {
              const expired = isShareExpired(s)
              return (
                <div
                  key={s.id}
                  className="group -mx-2 flex items-center gap-1 rounded-lg px-2 py-2.5 transition hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                >
                  <button
                    type="button"
                    onClick={() => openConversation(s.conversationId)}
                    title="在聊天中打开原对话"
                    className="group/title min-w-0 flex-1 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={clsx(
                          'truncate text-[13.5px] font-medium group-hover/title:underline',
                          expired
                            ? 'text-neutral-400 dark:text-neutral-500'
                            : 'text-neutral-800 dark:text-neutral-100',
                        )}
                      >
                        {s.title ?? '（无标题）'}
                      </span>
                      {expired && (
                        <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          已过期
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-neutral-400 dark:text-neutral-500">
                      分享于 {formatShortDate(s.updatedAt)} · {s.messageCount} 条消息
                      {!s.includeAttachments && ' · 不含附件'}
                      {s.expiresAt &&
                        ` · ${expired ? `已于 ${formatShortDate(s.expiresAt)} 过期` : `${formatShortDate(s.expiresAt)} 到期`}`}
                    </div>
                  </button>
                  <div
                    className={clsx(
                      'flex shrink-0 items-center gap-0.5 transition',
                      HOVER_REVEAL_CLASS,
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => copyLink(s.id, s.token)}
                      disabled={expired}
                      aria-label="复制链接"
                      title={expired ? '链接已过期' : '复制链接'}
                      className={clsx(iconButtonClass, expired && 'cursor-not-allowed opacity-40')}
                    >
                      {copiedId === s.id ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <CopyIcon className="h-4 w-4" />
                      )}
                    </button>
                    {expired ? (
                      <span
                        aria-hidden="true"
                        className={clsx(
                          iconButtonClass,
                          'cursor-not-allowed opacity-40 hover:bg-transparent',
                        )}
                      >
                        <ExternalLinkIcon className="h-4 w-4" />
                      </span>
                    ) : (
                      <a
                        href={`/s/${s.token}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="打开分享页"
                        title="打开分享页"
                        className={iconButtonClass}
                      >
                        <ExternalLinkIcon className="h-4 w-4" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setManagedId(s.conversationId)}
                      aria-label="分享设置"
                      title="分享设置（更新内容 / 有效期 / 停止分享）"
                      className={iconButtonClass}
                      data-testid="my-share-manage"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-2 px-1 text-right text-[12px] text-neutral-400 dark:text-neutral-500">
            共 {active.length} 个分享
          </p>
        </>
      )}
      {managedId && <ShareDialog conversationId={managedId} onClose={() => setManagedId(null)} />}
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
    <div className="pb-2">
      <SettingsSection title="个人资料">
        <div className="flex items-center gap-4 py-3">
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
                variant="ghost"
                className={clsx(
                  AVATAR_ACTION_BUTTON_CLASS,
                  'border-neutral-200/80 text-neutral-600 dark:border-neutral-700/80 dark:text-neutral-300',
                )}
                onClick={() => fileRef.current?.click()}
              >
                更换头像
              </Button>
              {me?.avatarUrl && (
                <Button
                  variant="ghost"
                  className={clsx(
                    AVATAR_ACTION_BUTTON_CLASS,
                    'border-neutral-200/60 text-neutral-500 hover:text-neutral-700 dark:border-neutral-700/60 dark:text-neutral-400 dark:hover:text-neutral-200',
                  )}
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

        <div className="py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              variant="filled"
              label="用户名"
              value={username}
              maxLength={32}
              autoComplete="username"
              error={usernameError}
              hint="用于登录"
              onChange={(e) => setUsername(e.target.value)}
            />
            <TextField
              variant="filled"
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
              variant="accent"
              className="!px-3 !py-1.5 text-xs"
              loading={updateProfile.isPending}
              disabled={!canSaveProfile}
              onClick={onSaveProfile}
            >
              保存资料
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="更换密码">
        <div className="py-3">
          <p className="mb-3 text-[12px] leading-5 text-neutral-400 dark:text-neutral-500">
            更新密码后，其它设备上的登录将全部失效。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              variant="filled"
              type="password"
              label="当前密码"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <TextField
              variant="filled"
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
              variant="accent"
              className="!px-3 !py-1.5 text-xs"
              loading={changePassword.isPending}
              disabled={currentPassword.length < 1 || newPassword.length < 6}
              onClick={onChangePassword}
            >
              更新密码
            </Button>
          </div>
        </div>
      </SettingsSection>

      {cropImageSrc && (
        <AvatarCropDialog
          imageSrc={cropImageSrc}
          uploading={uploadAvatar.isPending}
          onCancel={() => setCropImageSrc(null)}
          onConfirm={onCropConfirm}
        />
      )}

      <SettingsSection title="危险操作" danger>
        <div className="space-y-3">
          {/* 清除所有对话 */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[14px] text-neutral-900 dark:text-neutral-100">清除所有对话</div>
              <div className="text-[12px] text-neutral-500 dark:text-neutral-400">
                删除你的全部对话与附件，不可恢复。
              </div>
            </div>
            {confirmClear ? (
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                  取消
                </Button>
                <Button
                  variant="danger"
                  loading={clearConversations.isPending}
                  onClick={onClearAll}
                >
                  确认清除
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                className="shrink-0 !shadow-none"
                onClick={() => setConfirmClear(true)}
              >
                <DeleteIcon className="h-4 w-4" />
                清除对话
              </Button>
            )}
          </div>

          <div className="border-t border-red-100 dark:border-red-900/30" />

          {/* 删除账户 */}
          <div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[14px] text-neutral-900 dark:text-neutral-100">删除账户</div>
                <div className="text-[12px] text-neutral-500 dark:text-neutral-400">
                  永久删除账户及其全部数据，不可恢复。
                </div>
              </div>
              {!confirmDelete && (
                <Button
                  variant="danger"
                  className="shrink-0"
                  onClick={() => setConfirmDelete(true)}
                >
                  <UserRoundX className="h-4 w-4" />
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
      </SettingsSection>
    </div>
  )
}

export function SettingsDialog() {
  const { open, tab, closeDialog, setTab } = useSettingsDialog()
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 设置页上层可能叠加分享设置弹窗/确认框等模态，让最上层模态自行处理 Escape。
      if (document.querySelector('[aria-modal="true"]')) return
      closeDialog()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeDialog])

  useEffect(() => {
    if (!open) return
    contentRef.current?.scrollTo({ top: 0 })
  }, [open, tab])

  if (!open) return null

  const activeTabLabel = TABS.find((item) => item.id === tab)?.label ?? ''

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center sm:p-4"
      data-testid="settings-dialog"
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={closeDialog} />
      <div className="hc-pop-in relative z-10 flex h-full w-full flex-col overflow-hidden bg-white dark:bg-neutral-900 sm:h-[640px] sm:max-h-[88vh] sm:max-w-3xl sm:rounded-2xl sm:shadow-2xl sm:ring-1 sm:ring-black/5 dark:sm:ring-white/10">
        <button
          type="button"
          onClick={closeDialog}
          className="absolute right-3.5 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="关闭"
        >
          <X className="h-[18px] w-[18px]" />
        </button>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <aside className="flex shrink-0 flex-col border-b border-neutral-100 bg-neutral-50/80 dark:border-neutral-800 dark:bg-neutral-950/30 sm:w-52 sm:border-b-0 sm:border-r sm:border-neutral-200/70 dark:sm:border-neutral-800">
            <h3 className="flex h-14 shrink-0 items-center px-5 pt-2 text-[17px] font-semibold text-neutral-900 dark:text-neutral-100">
              设置
            </h3>

            <nav className="flex gap-1 overflow-x-auto px-3 pb-3 pt-1.5 sm:flex-1 sm:flex-col sm:overflow-visible sm:pb-3">
              {TABS.map((item) => {
                const Icon = item.icon
                const active = item.id === tab
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={clsx(
                      'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-left text-[13px] transition',
                      active
                        ? 'bg-black/[0.06] font-medium text-neutral-900 dark:bg-white/10 dark:text-white'
                        : 'text-neutral-500 hover:bg-black/[0.04] hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-200',
                    )}
                  >
                    <Icon
                      className={clsx(
                        'h-4 w-4',
                        active
                          ? 'text-neutral-700 dark:text-neutral-200'
                          : 'text-neutral-400 dark:text-neutral-500',
                      )}
                    />
                    {item.label}
                  </button>
                )
              })}
            </nav>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <h4 className="flex h-16 shrink-0 items-center px-5 pr-14 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100 sm:px-6">
              {activeTabLabel}
            </h4>
            <div
              ref={contentRef}
              className="hc-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-6"
            >
              {tab === 'general' && <GeneralPanel />}
              {tab === 'messages' && <MessagesPanel />}
              {tab === 'account' && <AccountPanel />}
              {tab === 'shares' && <SharesPanel />}
              {tab === 'about' && <AboutPanel />}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
