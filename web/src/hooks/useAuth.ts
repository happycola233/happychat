import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicUser } from '@shared/types/api'
import { ApiRequestError } from '../api/client'
import * as authApi from '../api/auth'

export function useMe() {
  return useQuery<PublicUser | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await authApi.getMe()).user
      } catch (e) {
        // 未登录视为 null，而非错误
        if (e instanceof ApiRequestError && e.status === 401) return null
        throw e
      }
    },
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => qc.setQueryData(['me'], data.user),
  })
}

export function useRegister() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: (data) => qc.setQueryData(['me'], data.user),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      qc.setQueryData(['me'], null)
      qc.removeQueries()
    },
  })
}
