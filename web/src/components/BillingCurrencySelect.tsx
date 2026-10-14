import { useBillingCurrency } from '../store/billingCurrency'
import { Select } from './ui/Select'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import type { ExchangeRateSnapshot } from '@shared/types/domain'

export function BillingCurrencySelect() {
  const { currency, setCurrency } = useBillingCurrency()
  const { data } = useQuery({
    queryKey: ['billing', 'exchange-rate'],
    queryFn: () =>
      apiGet<{ current: ExchangeRateSnapshot | null; legacy: ExchangeRateSnapshot | null }>(
        '/quota/exchange-rate',
      ),
    enabled: currency === 'CNY',
    staleTime: 300_000,
  })
  const title = data?.legacy
    ? `新账使用各笔请求汇率；旧账固定按 1 USD = ${data.legacy.usdToCny} CNY 折算（${new Date(data.legacy.fetchedAt).toLocaleDateString('zh-CN')}）。最近参考汇率：${data.current?.usdToCny ?? '暂无'}。`
    : '新账使用各笔请求汇率，旧账使用首次取得的固定折算基准。'
  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="费用显示币种"
        value={currency}
        options={[
          { value: 'USD', label: '美元 USD' },
          { value: 'CNY', label: '人民币 CNY' },
        ]}
        onChange={(event) => setCurrency(event.target.value as 'USD' | 'CNY')}
      />
      {currency === 'CNY' && (
        <span
          tabIndex={0}
          title={title}
          aria-label={title}
          className="cursor-help text-xs text-neutral-500 dark:text-neutral-400"
        >
          汇率说明
        </span>
      )}
    </div>
  )
}
