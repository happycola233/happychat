import type { AuthResponse, BootstrapStatus } from '@shared/types/api'
import type { LoginInput, RegisterInput } from '@shared/schemas/auth'
import { apiGet, apiPost } from './client'

export const getBootstrap = () => apiGet<BootstrapStatus>('/auth/bootstrap')
export const login = (input: LoginInput) => apiPost<AuthResponse>('/auth/login', input)
export const register = (input: RegisterInput) => apiPost<AuthResponse>('/auth/register', input)
export const logout = () => apiPost<{ ok: true }>('/auth/logout')
export const getMe = () => apiGet<AuthResponse>('/auth/me')
