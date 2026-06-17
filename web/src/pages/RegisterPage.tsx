import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiRequestError } from '../api/client'
import { getBootstrap } from '../api/auth'
import { useRegister } from '../hooks/useAuth'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'

export default function RegisterPage() {
  const navigate = useNavigate()
  const register = useRegister()
  const { data: bootstrap } = useQuery({ queryKey: ['bootstrap'], queryFn: getBootstrap })
  const needsBootstrap = bootstrap?.needsBootstrap ?? false

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await register.mutateAsync({
        username,
        password,
        inviteCode: needsBootstrap ? undefined : inviteCode,
      })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '注册失败，请稍后重试')
    }
  }

  return (
    <AuthLayout
      title="注册"
      subtitle="私有 AI 聊天站"
      footer={
        <span>
          已有账号？
          <Link to="/login" className="ml-1 font-medium text-neutral-900 dark:text-neutral-100">
            登录
          </Link>
        </span>
      }
    >
      {needsBootstrap && (
        <div className="mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          系统尚未初始化，当前注册的将是<strong className="font-semibold">首位管理员</strong>，无需邀请码。
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          label="用户名"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="3-32 位，字母数字下划线"
          autoFocus
        />
        <TextField
          label="密码"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="至少 6 位"
        />
        {!needsBootstrap && (
          <TextField
            label="邀请码"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="请输入邀请码"
          />
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" loading={register.isPending} className="w-full">
          注册
        </Button>
      </form>
    </AuthLayout>
  )
}
