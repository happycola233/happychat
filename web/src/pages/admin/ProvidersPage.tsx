import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ListPlus, Plus, PlugZap, RefreshCw, Search, Server } from 'lucide-react'
import { clsx } from 'clsx'
import type { ProviderDTO } from '@shared/types/api'
import { ApiRequestError } from '../../api/client'
import * as adminApi from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { cardSurface } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { PageHeader } from '../../components/ui/PageHeader'
import { TextField } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import { Spinner } from '../../components/ui/Spinner'
import { askConfirm } from '../../store/confirm'
import { toast } from '../../store/toast'
import { DeleteIcon } from '../../chat/icons'

export default function ProvidersPage() {
  const qc = useQueryClient()
  const { data: providers, isLoading } = useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: adminApi.listProviders,
  })
  const [editing, setEditing] = useState<ProviderDTO | null>(null)
  const [creating, setCreating] = useState(false)
  const [picking, setPicking] = useState<ProviderDTO | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'providers'] })

  const toggleEnabled = useMutation({
    mutationFn: (p: ProviderDTO) => adminApi.updateProvider(p.id, { enabled: !p.enabled }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })

  const test = useMutation({
    mutationFn: adminApi.testProvider,
    onSuccess: (r) => toast.success(`连接成功，发现 ${r.modelCount} 个模型`),
    onError: (e) => toast.error(e instanceof Error ? e.message : '连接失败'),
  })

  const sync = useMutation({
    mutationFn: adminApi.syncModels,
    onSuccess: (r) => {
      toast.success(`同步完成：新增 ${r.added} 个，共 ${r.total} 个`)
      qc.invalidateQueries({ queryKey: ['admin', 'models'] })
      invalidate()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '同步失败'),
  })

  const remove = useMutation({
    mutationFn: adminApi.deleteProvider,
    onSuccess: () => {
      toast.success('已删除')
      invalidate()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="提供商"
        description="配置 OpenAI 兼容的上游服务；可一键同步全部模型，或从目录中挑选添加。"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> 添加提供商
          </Button>
        }
      />

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !providers?.length ? (
        <EmptyState
          icon={Server}
          title="还没有提供商"
          action={
            <Button
              variant="secondary"
              className="!px-3 !py-1.5 text-xs"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5" /> 添加提供商
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <div key={p.id} className={cardSurface}>
              <div className="p-4 pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                      {p.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
                      {p.modelCount} 个模型
                    </span>
                    {!p.enabled && (
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                        已停用
                      </span>
                    )}
                  </div>
                  <Toggle checked={p.enabled} onChange={() => toggleEnabled.mutate(p)} />
                </div>
                {/* 元信息用等宽标签列，扫读时一眼对齐。 */}
                <dl className="mt-2.5 space-y-1 text-xs">
                  {(
                    [
                      ['Base URL', p.baseUrl],
                      ['API Key', p.apiKeyMask ?? '未设置'],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex items-baseline gap-2">
                      <dt className="w-16 shrink-0 text-neutral-400 dark:text-neutral-500">
                        {label}
                      </dt>
                      <dd className="min-w-0 truncate font-mono text-neutral-600 dark:text-neutral-300">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
                <Button
                  variant="secondary"
                  className="!px-3 !py-1.5 text-xs"
                  loading={test.isPending && test.variables === p.id}
                  onClick={() => test.mutate(p.id)}
                >
                  <PlugZap className="h-3.5 w-3.5" /> 测试连接
                </Button>
                <Button
                  variant="secondary"
                  className="!px-3 !py-1.5 text-xs"
                  onClick={() => setPicking(p)}
                  title="浏览上游目录，勾选想要的模型按需添加"
                >
                  <ListPlus className="h-3.5 w-3.5" /> 挑选模型
                </Button>
                <Button
                  variant="secondary"
                  className="!px-3 !py-1.5 text-xs"
                  loading={sync.isPending && sync.variables === p.id}
                  onClick={() => sync.mutate(p.id)}
                  title="拉取上游目录，把所有未添加的模型一次性入库"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> 同步全部
                </Button>
                <Button
                  variant="ghost"
                  className="!px-3 !py-1.5 text-xs"
                  onClick={() => setEditing(p)}
                >
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  className="ml-auto !px-3 !py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => {
                    void askConfirm({
                      title: '删除提供商？',
                      description: `提供商「${p.name}」及其下全部模型配置将被永久删除，且无法恢复。`,
                      confirmLabel: '删除',
                      tone: 'danger',
                    }).then((ok) => {
                      if (ok) remove.mutate(p.id)
                    })
                  }}
                >
                  <DeleteIcon className="h-3.5 w-3.5" /> 删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ProviderModal
          provider={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            invalidate()
          }}
        />
      )}

      {picking && <PickModelsModal provider={picking} onClose={() => setPicking(null)} />}
    </div>
  )
}

/**
 * 从供应商上游目录挑选模型添加：勾选后每个 id 新建一个模型实例。
 * 已添加过的 id 会标注实例数，仍可再勾选（同 id 多实例，用于配置不同参数）。
 */
function PickModelsModal({ provider, onClose }: { provider: ProviderDTO; onClose: () => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const catalog = useQuery({
    queryKey: ['admin', 'provider-catalog', provider.id],
    queryFn: () => adminApi.getProviderCatalog(provider.id),
    gcTime: 0,
    refetchOnWindowFocus: false,
  })

  const keyword = search.trim().toLowerCase()
  const filtered = useMemo(
    () => (catalog.data ?? []).filter((m) => !keyword || m.modelId.toLowerCase().includes(keyword)),
    [catalog.data, keyword],
  )
  const allFilteredSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.modelId))

  const toggleOne = (modelId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(modelId)) next.delete(modelId)
      else next.add(modelId)
      return next
    })
  }

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) filtered.forEach((m) => next.delete(m.modelId))
      else filtered.forEach((m) => next.add(m.modelId))
      return next
    })
  }

  const importModels = useMutation({
    mutationFn: () => adminApi.importProviderModels(provider.id, { modelIds: [...selected] }),
    onSuccess: (r) => {
      toast.success(`已添加 ${r.added} 个模型`)
      qc.invalidateQueries({ queryKey: ['admin', 'models'] })
      qc.invalidateQueries({ queryKey: ['admin', 'providers'] })
      qc.invalidateQueries({ queryKey: ['models'] })
      onClose()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '添加失败'),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={`挑选模型 · ${provider.name}`}
      size="form"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => importModels.mutate()}
            loading={importModels.isPending}
            disabled={selected.size === 0}
          >
            添加所选（{selected.size}）
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索模型 ID"
              autoFocus
              className="w-full rounded-lg border border-neutral-300 bg-white py-1.5 pl-9 pr-3 text-sm outline-none transition placeholder:text-neutral-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-sky-400"
            />
          </div>
          <button
            type="button"
            onClick={toggleAllFiltered}
            disabled={filtered.length === 0}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            {allFilteredSelected ? '取消全选' : '全选当前'}
          </button>
        </div>

        {catalog.isLoading ? (
          <div className="py-12 text-center">
            <Spinner className="h-6 w-6 text-neutral-400" />
          </div>
        ) : catalog.error ? (
          <p className="py-8 text-center text-sm text-red-500">
            {catalog.error instanceof Error ? catalog.error.message : '拉取上游模型目录失败'}
          </p>
        ) : !filtered.length ? (
          <div className="py-12 text-center text-sm text-neutral-400">
            {keyword ? '没有匹配的模型' : '上游未返回任何模型'}
          </div>
        ) : (
          <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-neutral-200 hc-scrollbar dark:border-neutral-700">
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {filtered.map((m) => {
                const checked = selected.has(m.modelId)
                return (
                  <label
                    key={m.modelId}
                    className={clsx(
                      'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                      checked && 'bg-sky-50/60 dark:bg-sky-500/5',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(m.modelId)}
                      className="h-4 w-4 shrink-0 accent-sky-500"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-800 dark:text-neutral-100">
                      {m.modelId}
                    </span>
                    {m.existingCount > 0 && (
                      <span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        已添加{m.existingCount > 1 ? ` ×${m.existingCount}` : ''}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>
        )}

        <p className="text-xs leading-5 text-neutral-400">
          勾选已添加过的模型会再创建一个实例（同 ID 可配置不同参数，对用户表现为两个模型）。
        </p>
      </div>
    </Modal>
  )
}

function ProviderModal({
  provider,
  onClose,
  onSaved,
}: {
  provider: ProviderDTO | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = Boolean(provider)
  const [name, setName] = useState(provider?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const providerDetail = useQuery({
    queryKey: ['admin', 'providers', provider?.id],
    queryFn: () => adminApi.getProvider(provider!.id),
    enabled: isEdit && Boolean(provider),
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const loadingProvider = isEdit && providerDetail.isFetching && !providerDetail.data

  useEffect(() => {
    if (!providerDetail.data) return
    setName(providerDetail.data.name)
    setBaseUrl(providerDetail.data.baseUrl)
    setApiKey(providerDetail.data.apiKey)
  }, [providerDetail.data])

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit && provider) {
        await adminApi.updateProvider(provider.id, {
          name,
          baseUrl,
          ...(apiKey.length > 0 ? { apiKey } : {}),
        })
      } else {
        await adminApi.createProvider({
          name,
          baseUrl,
          apiKey,
        })
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? '已保存' : '已添加')
      onSaved()
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : '保存失败'),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    save.mutate()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? '编辑提供商' : '添加提供商'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={onSubmit} loading={save.isPending} disabled={loadingProvider}>
            保存
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          label="名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：我的上游"
          autoFocus
        />
        <TextField
          label="Base URL"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          hint="通常以 /v1 结尾"
        />
        <TextField
          label="API Key"
          type="text"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={loadingProvider ? '正在加载完整 API Key...' : '请输入 API Key'}
          autoComplete="off"
          spellCheck={false}
          disabled={loadingProvider}
        />
        {providerDetail.error && (
          <p className="text-sm text-red-500">
            {providerDetail.error instanceof Error
              ? providerDetail.error.message
              : '加载 API Key 失败'}
          </p>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </form>
    </Modal>
  )
}
