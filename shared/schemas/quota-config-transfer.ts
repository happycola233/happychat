import { z } from 'zod'
import {
  QUOTA_MAX_RULES_PER_POLICY,
  QUOTA_MAX_RULE_PRIORITY,
  QUOTA_MAX_SCOPE_TARGETS,
  QUOTA_NOTE_MAX_LENGTH,
  QUOTA_RULE_LABEL_MAX_LENGTH,
} from '../util/quota'
import {
  quotaLimitSchema,
  quotaMetricSchema,
  quotaPolicyNameSchema,
  quotaWindowSchema,
} from './quota'

/** 额度策略导入导出文档的格式标识；版本只在出现不兼容变化时递增。 */
export const QUOTA_CONFIG_FORMAT = 'happychat-quota-config'
export const QUOTA_CONFIG_VERSION = 1
export const QUOTA_CONFIG_MAX_POLICIES = 100

const referencesSchema = (noun: string) =>
  z
    .array(z.string().trim().min(1))
    .min(1, `请选择至少一个${noun}`)
    .max(QUOTA_MAX_SCOPE_TARGETS, `单条规则最多选择 ${QUOTA_MAX_SCOPE_TARGETS} 个${noun}`)

const scopeModeSchema = z.enum(['each', 'shared']).default('each')

/** 文档里的适用范围：模型与分组按名称或 ID 引用，导入时解析成 ID。 */
export const quotaConfigScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }).strict(),
  z
    .object({ type: z.literal('models'), models: referencesSchema('模型'), mode: scopeModeSchema })
    .strict(),
  z
    .object({ type: z.literal('groups'), groups: referencesSchema('分组'), mode: scopeModeSchema })
    .strict(),
])

/** 文档里的一条规则；豁免可以省略周期。数值约束在解析引用后按正式规则校验。 */
export const quotaConfigRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(64).optional(),
    label: z.string().trim().max(QUOTA_RULE_LABEL_MAX_LENGTH).nullish(),
    scope: quotaConfigScopeSchema,
    metric: quotaMetricSchema,
    currency: z.enum(['USD', 'CNY']).optional(),
    limit: quotaLimitSchema,
    window: quotaWindowSchema.optional(),
    priority: z.number().int().min(0).max(QUOTA_MAX_RULE_PRIORITY).default(0),
  })
  .strict()

/**
 * 文档里的一个策略。带 id 时只更新出现的字段（rules 出现即整体替换）；不带 id 时按名称匹配
 * 已有策略，匹配不到就新建。未知字段直接报错，避免拼错的字段被静默忽略。
 */
export const quotaConfigPolicySchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    name: quotaPolicyNameSchema.optional(),
    description: z.string().trim().max(QUOTA_NOTE_MAX_LENGTH).nullable().optional(),
    isDefault: z.boolean().optional(),
    rules: z
      .array(quotaConfigRuleSchema)
      .max(QUOTA_MAX_RULES_PER_POLICY, `单个策略最多 ${QUOTA_MAX_RULES_PER_POLICY} 条规则`)
      .optional(),
  })
  .strict()

/** 外层只校验格式与数量；各策略逐条校验，便于在预览中逐项报告问题。 */
export const quotaConfigDocumentSchema = z.object({
  format: z.literal(QUOTA_CONFIG_FORMAT, { message: `format 必须是 "${QUOTA_CONFIG_FORMAT}"` }),
  version: z.literal(QUOTA_CONFIG_VERSION, { message: `version 必须是 ${QUOTA_CONFIG_VERSION}` }),
  policies: z
    .array(z.unknown())
    .min(1, '没有要导入的策略')
    .max(QUOTA_CONFIG_MAX_POLICIES, `单次最多导入 ${QUOTA_CONFIG_MAX_POLICIES} 个策略`),
})

export const quotaConfigImportSchema = z.object({ document: z.unknown() })

export type QuotaConfigRuleEntry = z.input<typeof quotaConfigRuleSchema>
export type QuotaConfigPolicyEntry = z.input<typeof quotaConfigPolicySchema>

/**
 * 交给 AI 生成或修改额度策略时附带的格式说明。管理端「复制给 AI 的说明」与文档共用这一份，
 * 保证说明与实际校验一致。
 */
export const QUOTA_CONFIG_AI_GUIDE = `你要生成一份 HappyChat 额度策略 JSON，用于管理后台「用户限额 → 导入 / 导出」。规则：

1. 顶层：{"format":"${QUOTA_CONFIG_FORMAT}","version":${QUOTA_CONFIG_VERSION},"policies":[...]}。models、groups、exportedAt 只是参考信息，导入时忽略。
2. 每个策略：
   - 带 "id"（来自导出文件）= 只更新你写出的字段；不带 "id" 时按 "name" 匹配已有策略，匹配不到就新建。
   - "name"：策略名称（新建时必填，最长 40 字）；"description"：仅管理员可见的备注。
   - "isDefault": true 设为默认策略（没有单独指派策略的用户都用它），整份文档最多一个。
   - "rules" 出现即整体替换该策略的全部规则；空数组表示不限额。保留导出文件里规则的 "id"，用户的单独调整与临时额度才不会丢失。
3. 每条规则：
   - "scope"：{"type":"all"} 全部模型；{"type":"models","models":[...],"mode":"each"}；{"type":"groups","groups":[...],"mode":"shared"}。models / groups 写名称或 ID（见参考信息，同名的模型配置必须写 ID）。mode：each = 每个目标各自一份额度，shared = 所选目标合用一份，缺省 each。
   - "metric"：cost 消费金额（文字 + 生图）、chat_cost 文字消费、image_cost 生图消费、images 生图张数、requests 请求次数。
   - "currency"：金额类计量的币种，"USD" 或 "CNY"，缺省 USD。
   - "limit"：{"kind":"amount","value":30} 是上限（次数与张数必须是整数，0 表示没有额度）；{"kind":"unlimited"} 是豁免。
   - "window"：{"type":"calendar","period":"day"|"week"|"month"} 自然日 / 周 / 月；{"type":"rolling","hours":5} 滚动窗口；{"type":"anchored","hours":720} 从首次请求起算的固定周期；{"type":"total"} 永久累计。豁免可以省略。
   - "priority"：0–${QUOTA_MAX_RULE_PRIORITY}，缺省 0。每个模型的文字用量和生图用量，分别只按命中它的最高一档规则计算；同一档的规则同时生效，任意一条用完就限制。
   - 豁免放行哪部分由 metric 决定：cost 或 requests 放行文字和生图；chat_cost 只放行文字；image_cost 或 images 只放行生图。豁免必须比要放行的规则优先级更高。
   - "label"：可选备注，最长 ${QUOTA_RULE_LABEL_MAX_LENGTH} 字。
4. 例子：「免费模型文字不限、所有模型每天最多生图 10 张」：
   {"label":"免费模型","scope":{"type":"models","models":["免费模型名称"]},"metric":"chat_cost","limit":{"kind":"unlimited"},"priority":1}
   {"label":"每日生图","scope":{"type":"all"},"metric":"images","limit":{"kind":"amount","value":10},"window":{"type":"calendar","period":"day"}}
5. 只输出 JSON 本身，不要附加解释或 Markdown 代码围栏。`
