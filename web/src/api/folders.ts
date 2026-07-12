import type { FolderDTO } from '@shared/types/api'
import type { CreateFolderInput, UpdateFolderInput } from '@shared/schemas/folder'
import { apiDelete, apiGet, apiPatch, apiPost } from './client'

export const listFolders = () => apiGet<{ folders: FolderDTO[] }>('/folders').then((r) => r.folders)

export const createFolder = (input: CreateFolderInput) =>
  apiPost<{ folder: FolderDTO }>('/folders', input).then((r) => r.folder)

/** color / emoji 传 null 表示恢复默认；pinned 控制置顶。 */
export const updateFolder = (id: string, patch: UpdateFolderInput) =>
  apiPatch<{ folder: FolderDTO }>(`/folders/${id}`, patch).then((r) => r.folder)

/** 删除文件夹：其中的聊天移回未分组，不会被删除。 */
export const deleteFolder = (id: string) => apiDelete<{ ok: true }>(`/folders/${id}`)
