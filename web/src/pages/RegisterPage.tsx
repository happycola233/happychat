import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LockKeyhole, Ticket, UserRound } from 'lucide-react'
import { ApiRequestError } from '../api/client'
import { getBootstrap } from '../api/auth'
import { useRegister } from '../hooks/useAuth'
import { AuthLayout, AuthLink } from '../components/auth/AuthLayout'
import { AuthField, AuthPasswordField } from '../components/auth/AuthField'
import { AuthNotice } from '../components/auth/AuthNotice'
import { AuthSubmitButton } from '../components/auth/AuthSubmitButton'
import { validatePassword, validateUsername } from '../components/auth/authValidation'
import { PasswordStrengthMeter } from '../components/auth/PasswordStrengthMeter'

/** 邀请码只可能是大写字母数字（服务端 `genInviteCode` 的字符集），顺手纠正小写与空格。 */
const normalizeInviteCode = (raw: string) => raw.toUpperCase().replace(/\s+/g, '')

export default function RegisterPage() {
  const navigate = useNavigate()
  const register = useRegister()
  const {
    data: bootstrap,
    isError: bootstrapFailed,
    refetch: refetchBootstrap,
  } = useQuery({
    queryKey: ['bootstrap'],
    queryFn: getBootstrap,
  })
  const needsBootstrap = bootstrap?.needsBootstrap ?? false
  // 公开配置尚未返回时按“需要邀请码”处理，避免加载窗口短暂开放无邀请码注册。
  const registrationRequiresInviteCode = bootstrap?.registrationRequiresInviteCode ?? true
  const requiresInviteCode = !needsBootstrap && registrationRequiresInviteCode
  // 邀请码字段与首位管理员提示都由公开配置决定显隐，所以等配置到位后才渲染这两块，
  // 否则开放注册的站点会先闪出一个邀请码输入框再消失。用户名 / 密码与提交按钮不受影响、
  // 一开始就可填，页面不会先摆一个空转的加载态。请求失败时按上面的保守默认继续渲染。
  const registrationPolicyReady = bootstrap !== undefined || bootstrapFailed
  const inviteCodeVisible = registrationPolicyReady && requiresInviteCode

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{
    username?: string
    password?: string
    inviteCode?: string
  }>({})
  const [error, setError] = useState('')
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const inviteCodeRef = useRef<HTMLInputElement>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (register.isPending) return
    setError('')

    const nextFieldErrors = {
      username: validateUsername(username),
      password: validatePassword(password),
      inviteCode: inviteCodeVisible && !inviteCode ? '请输入邀请码' : undefined,
    }
    setFieldErrors(nextFieldErrors)
    // 校验失败时把光标送到第一个出错的字段，用户不必自己在几行红字里找位置。
    const firstInvalidRef = nextFieldErrors.username
      ? usernameRef
      : nextFieldErrors.password
        ? passwordRef
        : nextFieldErrors.inviteCode
          ? inviteCodeRef
          : null
    if (firstInvalidRef) {
      firstInvalidRef.current?.focus()
      return
    }

    try {
      await register.mutateAsync({
        username: username.trim(),
        password,
        // 隐藏字段绝不提交；空白也归一为缺省，由服务端返回准确的领域错误。
        inviteCode: inviteCodeVisible && inviteCode ? inviteCode : undefined,
      })
      navigate('/', { replace: true })
    } catch (err) {
      // 管理员可能在用户填写期间切换了注册策略；失败后刷新即可让表单显现最新字段。
      void refetchBootstrap()
      setError(err instanceof ApiRequestError ? err.message : '注册失败，请稍后重试')
    }
  }

  return (
    <AuthLayout
      title="创建账号"
      subtitle="注册 HappyChat，开始你的第一次对话"
      notice={
        needsBootstrap ? (
          <AuthNotice tone="highlight">
            本站尚未初始化。你是首位用户，注册后将
            <strong className="font-semibold">自动成为管理员</strong>，无需邀请码。
          </AuthNotice>
        ) : undefined
      }
      footer={
        <>
          已有账号？<AuthLink to="/login">登录</AuthLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <AuthField
          label="用户名"
          icon={UserRound}
          inputRef={usernameRef}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="next"
          value={username}
          error={fieldErrors.username}
          hint="1–32 位，可用字母、数字、下划线、点和短横线"
          onChange={(e) => {
            setUsername(e.target.value)
            setFieldErrors((prev) => ({ ...prev, username: undefined }))
            setError('')
          }}
          placeholder="请输入用户名"
          autoFocus
        />
        <AuthPasswordField
          label="密码"
          icon={LockKeyhole}
          inputRef={passwordRef}
          autoComplete="new-password"
          enterKeyHint={inviteCodeVisible ? 'next' : 'go'}
          value={password}
          error={fieldErrors.password}
          labelAside={<PasswordStrengthMeter password={password} />}
          onChange={(e) => {
            setPassword(e.target.value)
            setFieldErrors((prev) => ({ ...prev, password: undefined }))
            setError('')
          }}
          placeholder="至少 6 位"
        />
        {inviteCodeVisible && (
          <div className="hc-anim-in">
            <AuthField
              label="邀请码"
              icon={Ticket}
              inputRef={inviteCodeRef}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={64}
              value={inviteCode}
              error={fieldErrors.inviteCode}
              hint="没有邀请码？请联系站点管理员。"
              inputClassName="hc-auth-field-code"
              onChange={(e) => {
                setInviteCode(normalizeInviteCode(e.target.value))
                setFieldErrors((prev) => ({ ...prev, inviteCode: undefined }))
                setError('')
              }}
              placeholder="请输入邀请码"
            />
          </div>
        )}
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        <AuthSubmitButton loading={register.isPending} loadingLabel="注册中…">
          注册
        </AuthSubmitButton>
      </form>
    </AuthLayout>
  )
}
