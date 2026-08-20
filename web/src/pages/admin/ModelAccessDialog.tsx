import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, TriangleAlert } from 'lucide-react'
import { MODEL_ACCESS_USER_LIMIT } from '@shared/schemas/model-config'
import type { AdminModelDTO, AdminUserDTO, ModelAccessDTO } from '@shared/types/api'
import * as adminApi from '../../api/admin'
import { ApiRequestError } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useMe } from '../../hooks/useAuth'
import { toast } from '../../store/toast'
import { keepExistingModelAccessUserIds, sameModelAccess } from './modelAccessSelection'
import { UserScopePanel } from './UserScopePanel'
import type { UserScopePanelCopy } from './UserScopePanel'

interface Props {
  model: AdminModelDTO
  onClose: () => void
}

function sameIds(left: ReadonlySet<string>, right: readonly string[]): boolean {
  return left.size === right.length && right.every((id) => left.has(id))
}

interface ModelAccessSnapshot {
  access: ModelAccessDTO
  users: AdminUserDTO[]
  ignoredUserCount: number
}

/**
 * 用户先读、访问策略后读，尽量让级联删除后的名单天然一致；若期间恰好新增并授权了账号，
 * 再补读一次用户。最终仍按现存账号归一化，绝不把界面无法呈现的 ID 带回保存请求。
 */
async function loadModelAccessSnapshot(modelId: string): Promise<ModelAccessSnapshot> {
  let users = await adminApi.listUsers()
  const access = await adminApi.getModelAccess(modelId)
  let userIds = keepExistingModelAccessUserIds(access.userIds, users)
  if (userIds.length !== access.userIds.length) {
    users = await adminApi.listUsers()
    userIds = keepExistingModelAccessUserIds(access.userIds, users)
  }
  return {
    access: { accessMode: access.accessMode, userIds },
    users,
    ignoredUserCount: access.userIds.length - userIds.length,
  }
}

class ModelAccessChangedError extends Error {
  constructor() {
    super('模型访问范围已变化')
    this.name = 'ModelAccessChangedError'
  }
}

/**
 * 模型权限单独读取：管理列表只带人数，避免每个模型都重复传整份用户 ID 列表。
 * 面板打开后才加载用户与授权详情，关闭即丢弃未保存草稿。
 */
export function ModelAccessDialog({ model, onClose }: Props) {
  const snapshot = useQuery({
    // 独立、短生命周期的编辑快照：不能用账号页或上次打开留下的 30 秒缓存初始化权限草稿。
    queryKey: ['admin', 'model-access-editor', model.id],
    queryFn: () => loadModelAccessSnapshot(model.id),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    // 编辑器自己管理显式冲突恢复；窗口切换时不能悄悄替换正在编辑的基准快照。
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [draftVersion, setDraftVersion] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<unknown>(null)

  const refreshAndResetDraft = async (notice: string) => {
    setRecovering(true)
    setRefreshNotice(null)
    setRefreshError(null)
    const refreshed = await snapshot.refetch({ cancelRefetch: true })
    setRecovering(false)
    if (refreshed.data && !refreshed.error) {
      setDraftVersion((version) => version + 1)
      setRefreshNotice(notice)
      return
    }
    setRefreshError(refreshed.error ?? new Error('重新加载用户范围失败'))
  }

  // 即使 QueryClient 里碰巧还有数据，也必须等本次挂载的网络读取完成后才能创建 useState 草稿。
  if (snapshot.data && snapshot.isFetchedAfterMount && !recovering && !refreshError) {
    return (
      <ModelAccessEditor
        key={`${model.id}:${draftVersion}`}
        model={model}
        access={snapshot.data.access}
        users={snapshot.data.users}
        refreshNotice={
          refreshNotice ??
          (snapshot.data.ignoredUserCount > 0
            ? `已忽略 ${snapshot.data.ignoredUserCount} 个已删除账号，请重新确认范围。`
            : null)
        }
        onRefreshRequired={(notice) => void refreshAndResetDraft(notice)}
        onClose={onClose}
      />
    )
  }

  const error = refreshError ?? (snapshot.isFetchedAfterMount ? snapshot.error : null)
  return (
    <Modal open onClose={onClose} title={`可用范围 · ${model.displayName}`} size="form">
      {error ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-red-500">
            {error instanceof Error ? error.message : '加载用户范围失败'}
          </p>
          <Button
            variant="secondary"
            className="!px-3 !py-2"
            onClick={() => void refreshAndResetDraft('已重新加载最新的用户与授权范围。')}
          >
            重新加载
          </Button>
        </div>
      ) : (
        <div className="flex min-h-52 items-center justify-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      )}
    </Modal>
  )
}

const MODEL_SCOPE_COPY: UserScopePanelCopy = {
  allCaption: '所有账号都能使用此模型，之后新注册的账号也会自动获得权限。',
  selectedCaption: '仅勾选的账号能使用此模型，新注册账号默认不可用。',
  allSummary: (userCount) => `当前 ${userCount} 位用户均可使用`,
  allDescription: '新注册的账号会自动获得使用权限，无需再次配置',
  emptySelection: '请至少选择 1 位用户；若要对所有人下架，请使用模型列表开关。',
  selectionOverLimit: (limit, selectedCount) =>
    `最多选择 ${limit.toLocaleString('zh-CN')} 位用户；当前已选 ${selectedCount.toLocaleString('zh-CN')} 位。`,
}

function ModelAccessEditor({
  model,
  access: loadedAccess,
  users: loadedUsers,
  refreshNotice,
  onRefreshRequired,
  onClose,
}: Props & {
  access: ModelAccessDTO
  users: AdminUserDTO[]
  refreshNotice: string | null
  onRefreshRequired: (notice: string) => void
}) {
  const qc = useQueryClient()
  const { data: me } = useMe()
  // 编辑期间冻结用户与权限基准；只有显式恢复递增 key 后才用服务端新快照重建草稿。
  const [baselineAccess] = useState<ModelAccessDTO>(() => ({
    accessMode: loadedAccess.accessMode,
    userIds: [...loadedAccess.userIds],
  }))
  const [users] = useState<AdminUserDTO[]>(() => [...loadedUsers])
  const [accessMode, setAccessMode] = useState(baselineAccess.accessMode)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(baselineAccess.userIds))

  const dirty =
    accessMode !== baselineAccess.accessMode ||
    (accessMode === 'selected' && !sameIds(selected, baselineAccess.userIds))
  const emptySelection = accessMode === 'selected' && selected.size === 0
  const selectionOverLimit = accessMode === 'selected' && selected.size > MODEL_ACCESS_USER_LIMIT

  const save = useMutation({
    mutationFn: async () => {
      // 完整名单采用替换语义；保存前做一次轻量冲突检查，避免旧面板覆盖另一位管理员的新授权。
      const latestAccess = await adminApi.getModelAccess(model.id)
      if (!sameModelAccess(latestAccess, baselineAccess)) throw new ModelAccessChangedError()
      await adminApi.updateModelAccess(model.id, {
        accessMode,
        userIds: accessMode === 'selected' ? [...selected] : [],
      })
    },
    onSuccess: () => {
      toast.success('已保存可用范围')
      qc.invalidateQueries({ queryKey: ['admin', 'models'] })
      // 当前管理员也可能刚被移出范围，用户端模型缓存必须立即按服务端重新过滤。
      qc.invalidateQueries({ queryKey: ['models'] })
      onClose()
    },
    onError: (error) => {
      if (error instanceof ModelAccessChangedError) {
        onRefreshRequired('授权范围已被其他操作更新；草稿未保存，已刷新为最新状态。')
        return
      }
      if (error instanceof ApiRequestError && error.code === 'unknown_users') {
        onRefreshRequired('有账号在编辑期间被删除；草稿未保存，已移除失效账号并刷新。')
        return
      }
      toast.error(error instanceof Error ? error.message : '保存可用范围失败')
    },
  })

  return (
    <Modal
      open
      onClose={save.isPending ? () => undefined : onClose}
      title={`可用范围 · ${model.displayName}`}
      size="form"
      footer={
        <>
          <span
            aria-live="polite"
            className="mr-auto min-w-0 self-center truncate text-xs tabular-nums text-neutral-400 dark:text-neutral-500"
          >
            {accessMode === 'all'
              ? `全部 ${users.length} 位用户可用`
              : `已选 ${selected.size} / ${users.length} 位用户`}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            取消
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!dirty || emptySelection || selectionOverLimit}
          >
            保存范围
          </Button>
        </>
      }
    >
      {/* 固定内容高度让两种模式切换时窗体不跳动，只有用户名单自身滚动。 */}
      <div className="flex h-[min(62vh,32rem)] min-h-0 flex-col gap-3 overflow-hidden">
        {!model.enabled && (
          <p className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-700 dark:border-amber-500/20 dark:bg-amber-950/25 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            此模型目前已全局停用；这里保存的范围会在重新启用后生效。
          </p>
        )}
        {refreshNotice && (
          <p
            role="status"
            className="flex shrink-0 items-start gap-2 rounded-lg border border-sky-200/70 bg-sky-50/70 px-3 py-2 text-xs leading-5 text-sky-700 dark:border-sky-500/20 dark:bg-sky-950/30 dark:text-sky-300"
          >
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {refreshNotice}
          </p>
        )}
        <UserScopePanel
          users={users}
          mode={accessMode}
          selected={selected}
          onModeChange={setAccessMode}
          onSelectionChange={setSelected}
          currentUserId={me?.id}
          selectionLimit={MODEL_ACCESS_USER_LIMIT}
          copy={MODEL_SCOPE_COPY}
          radioGroupLabel="模型可用范围模式"
        />
      </div>
    </Modal>
  )
}
