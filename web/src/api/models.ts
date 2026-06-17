import type { ModelDTO } from '@shared/types/api'
import { apiGet } from './client'

export const listModels = () => apiGet<{ models: ModelDTO[] }>('/models').then((r) => r.models)
