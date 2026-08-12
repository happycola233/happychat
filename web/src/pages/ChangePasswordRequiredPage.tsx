import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ApiRequestError } from '../api/client'
import { AuthLayout } from '../components/auth/AuthLayout'
import { AuthNotice } from '../components/auth/AuthNotice'
import { AuthPasswordField } from '../components/auth/AuthField'
import { AuthSubmitButton } from '../components/auth/AuthSubmitButton'
import { PasswordStrengthMeter } from '../components/auth/PasswordStrengthMeter'
import { validatePassword } from '../components/auth/authValidation'
import { useCompletePasswordReset, useLogout, useMe } from '../hooks/useAuth'
import { toast } from '../store/toast'

export default function ChangePasswordRequiredPage() {
  const navigate = useNavigate()
  const { data: user } = useMe()
  const completeReset = useCompletePasswordReset()
  const logout = useLogout()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{
    newPassword?: string
    confirmPassword?: string
  }>({})
  const [error, setError] = useState('')
  const newPasswordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (completeReset.isPending) return
    setError('')

    const nextFieldErrors = {
      newPassword: validatePassword(newPassword),
      confirmPassword: !confirmPassword
        ? '请再次输入新密码'
        : confirmPassword !== newPassword
          ? '两次输入的密码不一致'
          : undefined,
    }
    setFieldErrors(nextFieldErrors)
    if (nextFieldErrors.newPassword) {
      newPasswordRef.current?.focus()
      return
    }
    if (nextFieldErrors.confirmPassword) {
      confirmPasswordRef.current?.focus()
      return
    }

    try {
      await completeReset.mutateAsync({ newPassword })
      toast.success('新密码已设置')
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '设置失败，请稍后重试')
    }
  }

  const onLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => navigate('/login', { replace: true }),
      onError: () => setError('退出失败，请稍后重试'),
    })
  }

  return (
    <AuthLayout
      title="设置新密码"
      subtitle="完成此步骤后，才能继续使用 HappyChat"
      notice={
        <AuthNotice tone="highlight" icon={ShieldCheck}>
          管理员已重置此账号的密码。请设置一个不同于临时密码的新密码，以保护你的账号。
        </AuthNotice>
      }
      footer={
        <>
          不是账号{' '}
          <strong className="font-medium text-neutral-700 dark:text-neutral-200">
            {user?.username}
          </strong>
          ？
          <button
            type="button"
            disabled={logout.isPending}
            onClick={onLogout}
            className="font-medium text-neutral-900 underline decoration-neutral-300 decoration-1 underline-offset-[3px] transition hover:decoration-neutral-500 disabled:opacity-50 dark:text-neutral-100 dark:decoration-neutral-600 dark:hover:decoration-neutral-400"
          >
            退出登录
          </button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <AuthPasswordField
          label="新密码"
          icon={KeyRound}
          inputRef={newPasswordRef}
          autoComplete="new-password"
          enterKeyHint="next"
          value={newPassword}
          error={fieldErrors.newPassword}
          labelAside={<PasswordStrengthMeter password={newPassword} />}
          onChange={(event) => {
            setNewPassword(event.target.value)
            setFieldErrors((previous) => ({ ...previous, newPassword: undefined }))
            setError('')
          }}
          placeholder="至少 6 位"
          autoFocus
        />
        <AuthPasswordField
          label="确认新密码"
          icon={LockKeyhole}
          inputRef={confirmPasswordRef}
          autoComplete="new-password"
          enterKeyHint="go"
          value={confirmPassword}
          error={fieldErrors.confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value)
            setFieldErrors((previous) => ({ ...previous, confirmPassword: undefined }))
            setError('')
          }}
          placeholder="再次输入新密码"
        />
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        <AuthSubmitButton loading={completeReset.isPending} loadingLabel="保存中…">
          设置新密码并继续
        </AuthSubmitButton>
      </form>
    </AuthLayout>
  )
}
