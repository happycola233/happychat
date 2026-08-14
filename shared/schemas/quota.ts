import { z } from 'zod'
import {
  QUOTA_MAX_RULES_PER_POLICY,
  QUOTA_MAX_RULE_PRIORITY,
  QUOTA_MAX_SCOPE_TARGETS,
  QUOTA_NOTE_MAX_LENGTH,
  QUOTA_POLICY_NAME_MAX_LENGTH,
  QUOTA_RULE_LABEL_MAX_LENGTH,
} from '../util/quota'
import { QUOTA_ROLLING_MAX_HOURS } from '../util/quotaWindow'

const targetIdsSchema = (noun: string) =>
  z
    .array(z.string().trim().min(1))
    .min(1, `请选择至少一个${noun}`)
    .max(QUOTA_MAX_SCOPE_TARGETS, `单条规则最多选择 ${QUOTA_MAX_SCOPE_TARGETS} 个${noun}`)
    .refine((ids) => new Set(ids).size === ids.length, `${noun}列表不能包含重复项`)

/** each=每个目标各自独立额度；shared=所选目标共享一份额度。 */
const scopeModeSchema = z.enum(['each', 'shared'])

export const quotaScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({
    type: z.literal('models'),
    modelIds: targetIdsSchema('模型'),
    mode: scopeModeSchema,
  }),
  z.object({
    type: z.literal('groups'),
    groupIds: targetIdsSchema('分组'),
    mode: scopeModeSchema,
  }),
])

export const quotaWindowSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('calendar'), period: z.enum(['day', 'week', 'month']) }),
  z.object({
    type: z.literal('rolling'),
    hours: z
      .number()
      .int('滚动窗口必须是整数小时')
      .min(1, '滚动窗口至少 1 小时')
      .max(QUOTA_ROLLING_MAX_HOURS, '滚动窗口最长 8760 小时（1 年）'),
  }),
  z.object({ type: z.literal('total') }),
])

export const quotaMetricSchema = z.enum(['requests', 'cost'])

/** 上限：unlimited 是「豁免」（配合更高优先级放行）；amount 必须为正数（0 应当用「停用规则」表达）。 */
export const quotaLimitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unlimited') }),
  z.object({
    kind: z.literal('amount'),
    value: z.number().positive('额度上限必须大于 0').max(1_000_000_000),
  }),
])

export const quotaRuleSchema = z
  .object({
    // 规则 id 由编辑器生成并在整条生命周期内保持稳定：用户覆写与临时额度都靠它绑定。
    id: z.string().trim().min(1).max(64),
    label: z.string().trim().max(QUOTA_RULE_LABEL_MAX_LENGTH).nullish(),
    scope: quotaScopeSchema,
    metric: quotaMetricSchema,
    limit: quotaLimitSchema,
    window: quotaWindowSchema,
    /** 数字越大越优先；只有优先级最高的那一档规则对某个模型生效。默认 0。 */
    priority: z
      .number()
      .int('优先级必须是整数')
      .min(0, '优先级不能小于 0')
      .max(QUOTA_MAX_RULE_PRIORITY, `优先级最大 ${QUOTA_MAX_RULE_PRIORITY}`)
      .default(0),
  })
  // 次数没有小数：`1.5 次` 的上限既无法达成也无法展示。
  .refine(
    (rule) =>
      rule.metric !== 'requests' ||
      rule.limit.kind !== 'amount' ||
      Number.isInteger(rule.limit.value),
    { message: '请求次数上限必须是整数', path: ['limit'] },
  )
  .transform((rule) => ({ ...rule, label: rule.label?.trim() || null }))

export const quotaRulesSchema = z
  .array(quotaRuleSchema)
  .max(QUOTA_MAX_RULES_PER_POLICY, `单个策略最多 ${QUOTA_MAX_RULES_PER_POLICY} 条规则`)
  .refine((rules) => new Set(rules.map((r) => r.id)).size === rules.length, '规则 id 不能重复')

export const quotaPolicyNameSchema = z
  .string()
  .trim()
  .min(1, '请输入策略名称')
  .max(QUOTA_POLICY_NAME_MAX_LENGTH, `策略名称最长 ${QUOTA_POLICY_NAME_MAX_LENGTH} 字`)

export const quotaPolicyCreateSchema = z.object({
  name: quotaPolicyNameSchema,
  description: z.string().trim().max(QUOTA_NOTE_MAX_LENGTH).nullish(),
  /** 空数组即「无限额度」策略，是合法且常用的配置（如「朋友」策略）。 */
  rules: quotaRulesSchema.default([]),
  isDefault: z.boolean().default(false),
})

export const quotaPolicyUpdateSchema = z
  .object({
    name: quotaPolicyNameSchema.optional(),
    description: z.string().trim().max(QUOTA_NOTE_MAX_LENGTH).nullable().optional(),
    rules: quotaRulesSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '没有需要更新的内容' })

export const quotaPolicyReorderSchema = z.object({
  policyIds: z
    .array(z.string().min(1))
    .min(1, '请选择要排序的策略')
    .refine((ids) => new Set(ids).size === ids.length, '策略顺序不能包含重复项'),
})

export const quotaRuleOverrideSchema = z
  .object({
    limit: quotaLimitSchema.optional(),
    window: quotaWindowSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '覆写内容不能为空' })

export const userQuotaOverridesSchema = z.object({
  rules: z.record(z.string().trim().min(1).max(64), quotaRuleOverrideSchema).optional(),
  extraRules: quotaRulesSchema.optional(),
})

/**
 * 用户级配置：策略绑定 + 覆写 + 「暂停限额」。
 * policyId=null 表示回到默认策略；enforcementPaused 只绕过拦截，用量照常累计。
 */
export const userQuotaUpdateSchema = z.object({
  policyId: z.string().min(1).nullable(),
  overrides: userQuotaOverridesSchema.default({}),
  enforcementPaused: z.boolean().default(false),
  note: z.string().trim().max(QUOTA_NOTE_MAX_LENGTH).nullish(),
})

export const QUOTA_BATCH_ASSIGN_LIMIT = 1000

export const quotaBatchAssignSchema = z.object({
  userIds: z
    .array(z.string().min(1))
    .min(1, '请选择要修改的用户')
    .max(QUOTA_BATCH_ASSIGN_LIMIT, '单次最多修改 1000 个用户')
    .refine((ids) => new Set(ids).size === ids.length, '用户列表不能包含重复项'),
  policyId: z.string().min(1).nullable(),
})

/** 临时增加额度：只在当前周期内有效，周期结束自动失效，不改动长期配置。 */
export const quotaGrantCreateSchema = z.object({
  ruleId: z.string().trim().min(1),
  /** 「各自独立」规则必须指定具体模型/分组，否则一份赠送会被每个目标重复享用。 */
  bucketKey: z.string().trim().min(1).nullish(),
  amount: z.number().positive('赠送额度必须大于 0').max(1_000_000_000),
  note: z.string().trim().max(QUOTA_NOTE_MAX_LENGTH).nullish(),
})

/** 手动重置：ruleId 省略表示重置该用户全部规则的当前周期（含各自独立展开出的每个桶）。 */
export const quotaResetSchema = z
  .object({
    ruleId: z.string().trim().min(1).nullish(),
    bucketKey: z.string().trim().min(1).nullish(),
    note: z.string().trim().max(QUOTA_NOTE_MAX_LENGTH).nullish(),
  })
  // 只给 bucketKey 不给 ruleId 会被当成「重置全部」，与调用者的本意相反，直接拒绝。
  .refine((value) => !value.bucketKey || Boolean(value.ruleId), {
    message: '指定模型或分组时必须同时指定规则',
    path: ['ruleId'],
  })

/** 保存前预览：用草稿策略/覆写按真实用量算一遍最终生效结果。 */
export const quotaPreviewSchema = z.object({
  userId: z.string().min(1),
  policyId: z.string().min(1).nullable(),
  overrides: userQuotaOverridesSchema.default({}),
  enforcementPaused: z.boolean().default(false),
  /** 未保存的策略草稿；提供时优先于 policyId 对应的库中规则。 */
  draftRules: quotaRulesSchema.optional(),
})

export type QuotaPolicyCreateInput = z.infer<typeof quotaPolicyCreateSchema>
export type QuotaPolicyUpdateInput = z.infer<typeof quotaPolicyUpdateSchema>
export type QuotaPolicyReorderInput = z.infer<typeof quotaPolicyReorderSchema>
export type UserQuotaUpdateInput = z.infer<typeof userQuotaUpdateSchema>
export type QuotaBatchAssignInput = z.infer<typeof quotaBatchAssignSchema>
export type QuotaGrantCreateInput = z.infer<typeof quotaGrantCreateSchema>
export type QuotaResetInput = z.infer<typeof quotaResetSchema>
export type QuotaPreviewInput = z.infer<typeof quotaPreviewSchema>
