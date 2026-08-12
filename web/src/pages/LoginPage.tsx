import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LockKeyhole, Sparkles, UserRound } from 'lucide-react'
import { ApiRequestError } from '../api/client'
import { getBootstrap } from '../api/auth'
import { useLogin } from '../hooks/useAuth'
import { AuthLayout, AuthLink } from '../components/auth/AuthLayout'
import { AuthField, AuthPasswordField } from '../components/auth/AuthField'
import { AuthNotice } from '../components/auth/AuthNotice'
import { AuthSubmitButton } from '../components/auth/AuthSubmitButton'
import { validatePassword, validateUsername } from '../components/auth/authValidation'

export default function LoginPage() {
  const navigate = useNavigate()
  const login = useLogin()
  // 全新部署时登录必然走不通（库里还没有账号），提前把用户引到注册页去创建首位管理员。
  const { data: bootstrap } = useQuery({ queryKey: ['bootstrap'], queryFn: getBootstrap })

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({})
  const [error, setError] = useState('')
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (login.isPending) return
    setError('')

    const nextFieldErrors = {
      username: validateUsername(username),
      password: validatePassword(password),
    }
    setFieldErrors(nextFieldErrors)
    // 校验失败时把光标送到第一个出错的字段，用户不必自己在几行红字里找位置。
    if (nextFieldErrors.username) {
      usernameRef.current?.focus()
      return
    }
    if (nextFieldErrors.password) {
      passwordRef.current?.focus()
      return
    }

    try {
      const result = await login.mutateAsync({ username: username.trim(), password })
      navigate(result.user.mustChangePassword ? '/change-password' : '/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '登录失败，请稍后重试')
    }
  }

  return (
    <AuthLayout
      title="欢迎回来"
      subtitle="登录 HappyChat，继续你的对话"
      notice={
        bootstrap?.needsBootstrap ? (
          <AuthNotice icon={Sparkles}>
            本站尚未初始化，还没有任何账号。请先<AuthLink to="/register">注册首位管理员</AuthLink>。
          </AuthNotice>
        ) : undefined
      }
      footer={
        <>
          还没有账号？<AuthLink to="/register">注册</AuthLink>
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
          // 一开始输入就撤掉上一次的报错，避免用户边改边被红字盯着。
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
          autoComplete="current-password"
          enterKeyHint="go"
          value={password}
          error={fieldErrors.password}
          onChange={(e) => {
            setPassword(e.target.value)
            setFieldErrors((prev) => ({ ...prev, password: undefined }))
            setError('')
          }}
          placeholder="请输入密码"
        />
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        <AuthSubmitButton loading={login.isPending} loadingLabel="登录中…">
          登录
        </AuthSubmitButton>
      </form>
    </AuthLayout>
  )
}
