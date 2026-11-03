import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import type { ModelRouteHealthDTO, ProviderDTO } from '@shared/types/api'
import type { ModelKind, ModelPricing } from '@shared/types/domain'
import {
  MODEL_ROUTE_MAX_COUNT,
  MODEL_ROUTE_PRIORITY_MAX,
  MODEL_ROUTE_WEIGHT_MAX,
} from '@shared/schemas/model-config'
import { normalizeModelPricing } from '@shared/util/cost'
import * as adminApi from '../../api/admin'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { inputClass } from '../../components/ui/controlStyles'
import { ModelPricingEditor } from './ModelPricingEditor'
import { newRouteDraft, routeTiers, routesProtocol, type RouteDraft } from './modelRoutes'

// 中文段落拆成多行 JSX 文本会在换行处多出空格，因此整段放在一个字符串里。
const ROUTES_HINT =
  '同一模型可以接入多个供应商，或同一地址的多个 Key。优先级数字越大越先使用，同一优先级按权重分流；' +
  '某条线路出现超时、服务端错误、限流、鉴权或余额问题时，本次请求会立即切到下一条线路，' +
  '连续失败的线路会暂停使用一段时间后自动恢复。参数错误、内容审核等请求本身的问题不会切换线路。'
const smallLabelClass = 'mb-1 block text-xs text-neutral-500 dark:text-neutral-400'
const numberClass = `${inputClass} tabular-nums`

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} 秒` : `${ms} 毫秒`
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
}

/** 线路状态一行：熔断状态 + 近 24 小时指标；新线路保存前没有数据。 */
function RouteHealthLine({ health }: { health: ModelRouteHealthDTO | undefined }) {
  if (!health) return <p className="text-xs text-neutral-400">保存后开始统计运行状况</p>
  const stateBadge =
    health.state === 'cooling' ? (
      <Badge tone="danger">暂停使用至 {formatClock(health.cooldownUntil!)}</Badge>
    ) : health.state === 'degraded' ? (
      <Badge tone="warning">最近连续失败 {health.consecutiveFailures} 次</Badge>
    ) : (
      <Badge tone="success">正常</Badge>
    )
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
      {stateBadge}
      <span>
        近 24 小时 {health.recentRequests} 次
        {health.recentFailures > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            {' '}
            · 失败 {health.recentFailures}
          </span>
        )}
        {health.recentAvgLatencyMs !== null &&
          ` · 平均首响应 ${formatDuration(health.recentAvgLatencyMs)}`}
      </span>
      {health.lastFailureMessage && health.state !== 'healthy' && (
        <span className="min-w-0 truncate" title={health.lastFailureMessage}>
          最近失败：{health.lastFailureMessage}
        </span>
      )}
    </div>
  )
}

/** 调度顺序预览：优先级从高到低依次尝试，同档内按权重分流。 */
function RouteOrderPreview({
  drafts,
  providerName,
}: {
  drafts: RouteDraft[]
  providerName: (providerId: string) => string
}) {
  const { tiers, disabled } = routeTiers(
    drafts.map((draft, index) => ({
      key: draft.draftId,
      label: `${index + 1}. ${providerName(draft.providerId)}`,
      priority: draft.priority,
      weight: draft.weight,
      enabled: draft.enabled,
    })),
  )
  if (tiers.length === 0)
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
        当前没有启用的线路，用户将无法使用该模型。
      </p>
    )
  return (
    <ol className="space-y-1.5" aria-label="调度顺序">
      {tiers.map((tier, index) => (
        <li key={tier.priority}>
          {index > 0 && (
            <div className="flex items-center gap-1.5 py-0.5 pl-1 text-[11px] text-neutral-400">
              <ArrowDown className="h-3 w-3" aria-hidden />
              以上线路都不可用时
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
              {index === 0 ? '首选' : `备用 ${index}`} · {tier.priority}
            </span>
            {tier.items.map((item) => (
              <span
                key={item.key}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
              >
                {item.label}
                {tier.items.length > 1 && (
                  <span className="tabular-nums opacity-75">{Math.round(item.share * 100)}%</span>
                )}
              </span>
            ))}
          </div>
        </li>
      ))}
      {disabled.length > 0 && (
        <li className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="w-20 shrink-0 text-xs text-neutral-400">已停用</span>
          {disabled.map((item) => (
            <span
              key={item.key}
              className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-400 line-through dark:bg-neutral-800"
            >
              {item.label}
            </span>
          ))}
        </li>
      )}
    </ol>
  )
}

function RouteCard({
  index,
  draft,
  kind,
  canonicalModelId,
  providers,
  share,
  health,
  billingPricing,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number
  draft: RouteDraft
  kind: ModelKind
  canonicalModelId: string
  providers: ProviderDTO[]
  share: number | null
  health: ModelRouteHealthDTO | undefined
  billingPricing: ModelPricing
  canRemove: boolean
  onChange: (patch: Partial<RouteDraft>) => void
  onRemove: () => void
}) {
  const id = useId()
  const [costOpen, setCostOpen] = useState(draft.costPricing !== null)
  const provider = providers.find((item) => item.id === draft.providerId)
  const customCost = draft.costPricing !== null
  return (
    <li
      className={clsx(
        'space-y-3 rounded-xl border p-3.5 transition',
        draft.enabled
          ? 'border-neutral-200 dark:border-neutral-700'
          : 'border-dashed border-neutral-200 opacity-70 dark:border-neutral-700',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          线路 {index + 1}
        </span>
        {provider && (
          <Badge tone="neutral">
            {provider.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'}
          </Badge>
        )}
        {provider && !provider.enabled && <Badge tone="warning">供应商已停用</Badge>}
        <div className="ml-auto flex items-center gap-1">
          <Toggle
            ariaLabel={`启用线路 ${index + 1}`}
            checked={draft.enabled}
            onChange={(enabled) => onChange({ enabled })}
          />
          <IconButton
            label={`删除线路 ${index + 1}`}
            tone="danger"
            disabled={!canRemove}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={smallLabelClass} htmlFor={`${id}-provider`}>
            供应商
          </label>
          <Select
            id={`${id}-provider`}
            size="md"
            className="w-full"
            value={draft.providerId}
            onChange={(event) => onChange({ providerId: event.target.value })}
            options={[
              ...(provider ? [] : [{ value: draft.providerId, label: '请选择供应商' }]),
              ...providers.map((item) => ({
                value: item.id,
                label: item.enabled ? item.name : `${item.name}（已停用）`,
                description: item.baseUrl,
              })),
            ]}
          />
        </div>
        <div>
          <label className={smallLabelClass} htmlFor={`${id}-upstream`}>
            上游模型 ID
          </label>
          <input
            id={`${id}-upstream`}
            className={inputClass}
            value={draft.upstreamModelId}
            onChange={(event) => onChange({ upstreamModelId: event.target.value })}
            placeholder={canonicalModelId ? `沿用 ${canonicalModelId}` : '沿用模型 ID'}
            spellCheck={false}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-24">
          <label className={smallLabelClass} htmlFor={`${id}-priority`}>
            优先级
          </label>
          <input
            id={`${id}-priority`}
            className={numberClass}
            type="number"
            min={0}
            max={MODEL_ROUTE_PRIORITY_MAX}
            step={1}
            value={draft.priority}
            onChange={(event) =>
              onChange({ priority: Math.trunc(Number(event.target.value) || 0) })
            }
          />
        </div>
        <div className="w-24">
          <label className={smallLabelClass} htmlFor={`${id}-weight`}>
            权重
          </label>
          <input
            id={`${id}-weight`}
            className={numberClass}
            type="number"
            min={1}
            max={MODEL_ROUTE_WEIGHT_MAX}
            step={1}
            value={draft.weight}
            onChange={(event) => onChange({ weight: Math.trunc(Number(event.target.value) || 1) })}
          />
        </div>
        {share !== null && (
          <p className="pb-2 text-xs text-neutral-500 dark:text-neutral-400">
            同优先级分到 <span className="tabular-nums">{Math.round(share * 100)}%</span> 的请求
          </p>
        )}
      </div>

      <RouteHealthLine health={health} />

      <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left text-sm"
          aria-expanded={costOpen}
          onClick={() => setCostOpen(!costOpen)}
        >
          <span className="font-medium text-neutral-700 dark:text-neutral-200">上游成本价</span>
          <span className="text-xs text-neutral-400">
            {customCost ? '单独设置' : '与用户计价相同'}
          </span>
          <ChevronDown
            className={clsx(
              'ml-auto h-4 w-4 text-neutral-400 transition',
              costOpen && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
        {costOpen && (
          <div className="mt-3 space-y-4">
            <label className="flex items-center justify-between gap-4">
              <span className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                该供应商实际向你收取的价格，只用于后台成本统计；用户看到的金额和额度扣减始终按「用户计价」。
              </span>
              <Toggle
                ariaLabel="单独设置成本价"
                checked={customCost}
                onChange={(enabled) =>
                  onChange({
                    // 首次单独设置时以当前用户计价为起点，通常只需改几个数字。
                    costPricing: enabled
                      ? normalizeModelPricing(
                          { ...billingPricing, imagePricingModelId: undefined },
                          kind,
                        )
                      : null,
                  })
                }
              />
            </label>
            {customCost && (
              <ModelPricingEditor
                kind={kind}
                pricing={normalizeModelPricing(draft.costPricing, kind)}
                onChange={(costPricing) => onChange({ costPricing })}
                imageSources={[]}
              />
            )}
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * 模型的上游线路：同一模型可由多个供应商（或同一地址的多个 Key）承接。
 * 线路的增删改与模型其他配置一起保存。
 */
export function ModelRoutesEditor({
  kind,
  canonicalModelId,
  routes,
  onChange,
  providers,
  billingPricing,
}: {
  kind: ModelKind
  canonicalModelId: string
  routes: RouteDraft[]
  onChange: (routes: RouteDraft[]) => void
  providers: ProviderDTO[]
  billingPricing: ModelPricing
}) {
  const savedIds = routes.flatMap((route) => (route.id ? [route.id] : []))
  const { data: health } = useQuery({
    queryKey: ['admin', 'route-health', savedIds],
    queryFn: () => adminApi.getRouteHealth(savedIds),
    enabled: savedIds.length > 0,
    refetchInterval: 15_000,
  })
  const healthById = new Map((health ?? []).map((item) => [item.routeId, item]))
  const providerName = (providerId: string) =>
    providers.find((provider) => provider.id === providerId)?.name ?? '未选择供应商'
  const { protocol, mixed } = routesProtocol(routes, providers)
  const shares = new Map(
    routeTiers(
      routes.map((route) => ({
        key: route.draftId,
        label: '',
        priority: route.priority,
        weight: route.weight,
        enabled: route.enabled,
      })),
    ).tiers.flatMap((tier) =>
      tier.items.length > 1 ? tier.items.map((item) => [item.key, item.share] as const) : [],
    ),
  )
  const update = (draftId: string, patch: Partial<RouteDraft>) =>
    onChange(routes.map((route) => (route.draftId === draftId ? { ...route, ...patch } : route)))
  // 新线路默认放到当前最低优先级作为备用，并优先选择协议一致、尚未使用的供应商。
  const addRoute = () => {
    const used = new Set(routes.map((route) => route.providerId))
    const candidates = providers.filter((provider) => !protocol || provider.protocol === protocol)
    const provider =
      candidates.find((item) => item.enabled && !used.has(item.id)) ?? candidates[0] ?? providers[0]
    const lowest = routes.length ? Math.min(...routes.map((route) => route.priority)) : 0
    onChange([
      ...routes,
      newRouteDraft(provider?.id ?? '', routes.length ? Math.max(0, lowest - 1) : 0),
    ])
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">{ROUTES_HINT}</p>

      <div className="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
        <p className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">调度顺序</p>
        <RouteOrderPreview drafts={routes} providerName={providerName} />
      </div>

      {mixed && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          所有线路必须使用同一种协议的供应商（OpenAI 兼容或 Anthropic），请调整后再保存。
        </p>
      )}

      <ol className="space-y-3">
        {routes.map((route, index) => (
          <RouteCard
            key={route.draftId}
            index={index}
            draft={route}
            kind={kind}
            canonicalModelId={canonicalModelId}
            providers={providers}
            share={shares.get(route.draftId) ?? null}
            health={route.id ? healthById.get(route.id) : undefined}
            billingPricing={billingPricing}
            canRemove={routes.length > 1}
            onChange={(patch) => update(route.draftId, patch)}
            onRemove={() => onChange(routes.filter((item) => item.draftId !== route.draftId))}
          />
        ))}
      </ol>

      <Button
        variant="secondary"
        onClick={addRoute}
        disabled={routes.length >= MODEL_ROUTE_MAX_COUNT || providers.length === 0}
      >
        <Plus className="h-4 w-4" aria-hidden />
        添加线路
      </Button>
    </div>
  )
}
