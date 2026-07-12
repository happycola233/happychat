import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FolderDTO } from '@shared/types/api'
import type { CreateFolderInput, UpdateFolderInput } from '@shared/schemas/folder'
import { createFolder, deleteFolder, listFolders, updateFolder } from '../api/folders'
import { askConfirm } from '../store/confirm'
import { toast } from '../store/toast'

export function useFolders() {
  return useQuery({ queryKey: ['folders'], queryFn: listFolders })
}

/** 文件夹操作（创建/更新/置顶/删除），侧栏文件夹菜单与文件夹设置弹窗共用。 */
export function useFolderActions() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['folders'] })

  const create = useMutation({
    mutationFn: (input: CreateFolderInput) => createFolder(input),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : '创建文件夹失败'),
  })

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateFolderInput }) =>
      updateFolder(id, patch),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : '更新文件夹失败'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteFolder(id),
    onSuccess: () => {
      invalidate()
      // 文件夹内的会话被移回未分组，会话列表也需要刷新。
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除文件夹失败'),
  })

  const togglePin = (folderId: string, pinned: boolean) => {
    update.mutate({ id: folderId, patch: { pinned } })
  }

  /** 删除前确认；memberCount 用于说明其中聊天的去向。 */
  const deleteWithConfirm = (folder: FolderDTO, memberCount: number) => {
    void askConfirm({
      title: `删除文件夹「${folder.name}」？`,
      description:
        memberCount > 0
          ? `其中的 ${memberCount} 个聊天不会被删除，将移回「聊天」列表。`
          : '该文件夹是空的，删除后无法恢复。',
      confirmLabel: '删除',
      tone: 'danger',
    }).then((confirmed) => {
      if (confirmed) remove.mutate(folder.id)
    })
  }

  return { create, update, togglePin, deleteWithConfirm }
}
