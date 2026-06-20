import type { PublicUser, UserSettingsDTO } from '@shared/types/api'
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  UpdateProfileInput,
  UpdateSettingsInput,
} from '@shared/schemas/settings'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload } from './client'

export const getSettings = () =>
  apiGet<{ settings: UserSettingsDTO }>('/auth/settings').then((r) => r.settings)

export const updateSettings = (patch: UpdateSettingsInput) =>
  apiPut<{ settings: UserSettingsDTO }>('/auth/settings', patch).then((r) => r.settings)

export const changePassword = (input: ChangePasswordInput) =>
  apiPost<{ ok: true }>('/auth/change-password', input)

export const updateProfile = (input: UpdateProfileInput) =>
  apiPatch<{ user: PublicUser }>('/auth/profile', input).then((r) => r.user)

export const uploadAvatar = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return apiUpload<{ user: PublicUser }>('/auth/avatar', fd).then((r) => r.user)
}

export const removeAvatar = () =>
  apiDelete<{ user: PublicUser }>('/auth/avatar').then((r) => r.user)

export const deleteAccount = (input: DeleteAccountInput) =>
  apiDelete<{ ok: true }>('/auth/account', input)
