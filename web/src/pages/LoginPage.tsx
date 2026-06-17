import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiRequestError } from '../api/client'
import { useLogin } from '../hooks/useAuth'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'

export default function LoginPage() {
  const navigate = useNavigate()
  const login = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await login.mutateAsync({ username, password })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '登录失败，请稍后重试')
    }
  }

  return (
    <AuthLayout
      title="登录"
      subtitle="私有 AI 聊天站"
      footer={
        <span>
          还没有账号？
          <Link to="/register" className="ml-1 font-medium text-neutral-900 dark:text-neutral-100">
            注册
          </Link>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          label="用户名"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="请输入用户名"
          autoFocus
        />
        <TextField
          label="密码"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" loading={login.isPending} className="w-full">
          登录
        </Button>
      </form>
    </AuthLayout>
  )
}
