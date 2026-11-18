import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, UserRoundX } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { TextField } from '../../components/ui/TextField'
import { useMe } from '../../hooks/useAuth'
import {
  useChangePassword,
  useClearConversations,
  useDeleteAccount,
  useRemoveAvatar,
  useUpdateProfile,
  useUploadAvatar,
} from '../../hooks/useSettings'
import { toast } from '../../store/toast'
import { AvatarCropDialog } from '../AvatarCropDialog'
import { DeleteIcon } from '../icons'
import { SettingsRow } from './SettingsControls'

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/
/** 危险区的入口按钮：红字浅底，点击后才出现实心红色的最终确认按钮。 */
const DANGER_SOFT_BUTTON_CLASS =
  '!bg-red-500/[0.08] text-red-600 hover:!bg-red-500/[0.14] dark:!bg-red-400/10 dark:text-red-400 dark:hover:!bg-red-400/[0.16]'

export function AccountPanel() {
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

  const shownName = me?.displayName || me?.username || ''
  const avatarInitial = (shownName || 'U').slice(0, 1).toLocaleUpperCase()

  return (
    <div className="space-y-10">
      <SettingsSection title="个人资料">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4">
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
            className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-full ring-1 ring-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 dark:ring-white/10 dark:focus-visible:ring-offset-neutral-900"
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
          <div className="min-w-0 flex-1 basis-40">
            <div className="truncate text-[15px] font-medium text-neutral-900 dark:text-neutral-100">
              {shownName}
            </div>
            <div className="mt-0.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">
              支持 PNG、JPG、WebP，上传前可裁切
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {me?.avatarUrl && (
              <Button
                variant="ghost"
                size="sm"
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
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              更换头像
            </Button>
          </div>
        </div>

        <div className="py-4">
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
              hint="展示给自己与分享页"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="accent"
              size="sm"
              loading={updateProfile.isPending}
              disabled={!canSaveProfile}
              onClick={onSaveProfile}
            >
              保存资料
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="更换密码" description="更新密码后，其他设备上的登录将全部失效。">
        <div className="py-4">
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
              variant="accent"
              size="sm"
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
        <SettingsRow
          title="清除所有对话"
          description="删除你的全部对话与附件，不可恢复。"
          control={
            confirmClear ? (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
                  取消
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={clearConversations.isPending}
                  onClick={onClearAll}
                >
                  确认清除
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className={DANGER_SOFT_BUTTON_CLASS}
                onClick={() => setConfirmClear(true)}
              >
                <DeleteIcon className="h-4 w-4" />
                清除对话
              </Button>
            )
          }
        />
        <div>
          <SettingsRow
            title="删除账户"
            description="永久删除账户及其全部数据，不可恢复。"
            control={
              !confirmDelete && (
                <Button
                  variant="secondary"
                  size="sm"
                  className={DANGER_SOFT_BUTTON_CLASS}
                  onClick={() => setConfirmDelete(true)}
                >
                  <UserRoundX className="h-4 w-4" />
                  删除账户
                </Button>
              )
            }
          />
          {confirmDelete && (
            <div className="space-y-2.5 pb-4">
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
                  size="sm"
                  onClick={() => {
                    setConfirmDelete(false)
                    setDeletePassword('')
                  }}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  size="sm"
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
      </SettingsSection>
    </div>
  )
}
