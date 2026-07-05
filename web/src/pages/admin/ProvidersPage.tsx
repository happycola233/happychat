import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Wifi } from 'lucide-react'
import type { ProviderDTO } from '@shared/types/api'
import { ApiRequestError } from '../../api/client'
import * as adminApi from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { TextField } from '../../components/ui/TextField'
import { Toggle } from '../../components/ui/Toggle'
import { Spinner } from '../../components/ui/Spinner'
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
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">提供商</h1>
          <p className="mt-1 text-sm text-neutral-500">配置 OpenAI 兼容的上游服务并同步模型</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> 添加提供商
        </Button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !providers?.length ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
          还没有提供商，点击右上角「添加提供商」开始配置。
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">
                      {p.name}
                    </span>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
                      {p.modelCount} 个模型
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-neutral-500">{p.baseUrl}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">API Key：{p.apiKeyMask ?? '未设置'}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    缓存保留：{p.promptCacheRetention === '24h' ? '24 小时扩展缓存' : '上游默认'}
                  </p>
                </div>
                <Toggle checked={p.enabled} onChange={() => toggleEnabled.mutate(p)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="!px-3 !py-1.5 text-xs"
                  loading={test.isPending && test.variables === p.id}
                  onClick={() => test.mutate(p.id)}
                >
                  <Wifi className="h-3.5 w-3.5" /> 测试连接
                </Button>
                <Button
                  variant="secondary"
                  className="!px-3 !py-1.5 text-xs"
                  loading={sync.isPending && sync.variables === p.id}
                  onClick={() => sync.mutate(p.id)}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> 同步模型
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
                  className="!px-3 !py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => {
                    if (confirm(`确定删除提供商「${p.name}」？其下所有模型也会被删除。`))
                      remove.mutate(p.id)
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
    </div>
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
  const [promptCacheRetention, setPromptCacheRetention] = useState<'' | '24h'>(
    provider?.promptCacheRetention ?? '',
  )
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
    setPromptCacheRetention(providerDetail.data.promptCacheRetention ?? '')
  }, [providerDetail.data])

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit && provider) {
        await adminApi.updateProvider(provider.id, {
          name,
          baseUrl,
          ...(apiKey.length > 0 ? { apiKey } : {}),
          promptCacheRetention: promptCacheRetention || null,
        })
      } else {
        await adminApi.createProvider({
          name,
          baseUrl,
          apiKey,
          promptCacheRetention: promptCacheRetention || null,
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
          placeholder="https://api.example.com/llm/v1"
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
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            提示词缓存保留策略
          </span>
          <select
            className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            value={promptCacheRetention}
            onChange={(e) => setPromptCacheRetention(e.target.value as '' | '24h')}
          >
            <option value="">上游默认（兼容性最佳）</option>
            <option value="24h">24 小时扩展缓存</option>
          </select>
          <span className="mt-1.5 block text-xs leading-5 text-neutral-400">
            仅应用于已开启“应用提供商的缓存保留策略”的文本模型；请先确认该上游及模型支持 24h。
          </span>
        </label>
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
