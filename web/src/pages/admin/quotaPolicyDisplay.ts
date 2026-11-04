import type { AdminQuotaPolicyDTO } from '@shared/types/api'

/** 策略的一行概况：规则数（零规则即不限额）与使用人数。 */
export function describeQuotaPolicyBrief(
  policy: Pick<AdminQuotaPolicyDTO, 'rules' | 'boundUserCount'>,
): string {
  const rules = policy.rules.length > 0 ? `${policy.rules.length} 条规则` : '不限额'
  return `${rules} · ${policy.boundUserCount} 人`
}
