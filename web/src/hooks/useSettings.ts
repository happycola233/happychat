import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicUser } from '@shared/types/api'
import * as settingsApi from '../api/settings'
import { clearAllConversations } from '../api/chat'
import { useSettings } from '../store/settings'
import { useMe } from './useAuth'

/**
 * 登录后拉取服务端设置真值并 hydrate 到 settings store（覆盖本地缓存）。
 * 在 App 顶层调用一次即可。
 */
export function useSettingsSync(): void {
  const { data: me } = useMe()
  const hydrate = useSettings((s) => s.hydrate)
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.getSettings,
    enabled: !!me,
    staleTime: 60_000,
  })
  useEffect(() => {
    if (data) hydrate(data)
  }, [data, hydrate])
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: settingsApi.updateProfile,
    onSuccess: (user: PublicUser) => qc.setQueryData(['me'], user),
  })
}

export function useChangePassword() {
  return useMutation({ mutationFn: settingsApi.changePassword })
}

export function useUploadAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: settingsApi.uploadAvatar,
    onSuccess: (user: PublicUser) => qc.setQueryData(['me'], user),
  })
}

export function useRemoveAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: settingsApi.removeAvatar,
    onSuccess: (user: PublicUser) => qc.setQueryData(['me'], user),
  })
}

export function useDeleteAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: settingsApi.deleteAccount,
    onSuccess: () => {
      qc.setQueryData(['me'], null)
      qc.removeQueries()
    },
  })
}

export function useClearConversations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: clearAllConversations,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  })
}
