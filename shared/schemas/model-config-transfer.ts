import { z } from 'zod'
import {
  MODEL_ROUTE_MAX_COUNT,
  modelRouteInputSchema,
  modelUpdateSchema,
  routeCostPricingSchema,
} from './model-config'
import { modelGroupNameSchema } from './model-group'

/** 模型配置导入导出文档的格式标识；版本只在出现不兼容变化时递增。 */
export const MODEL_CONFIG_FORMAT = 'happychat-model-config'
export const MODEL_CONFIG_VERSION = 1
export const MODEL_CONFIG_MAX_MODELS = 500

/** 文档里的一条线路：供应商按 ID 或名称引用，导入不会创建或修改供应商。 */
export const modelConfigRouteSchema = modelRouteInputSchema
  .omit({ providerId: true, costPricing: true })
  .extend({
    provider: z.string().trim().min(1, '请填写供应商名称或 ID'),
    costPricing: routeCostPricingSchema.nullable().optional(),
  })
  .strict()

/**
 * 文档里的一个模型。带 id 时只更新出现的字段（routes 出现即整体替换线路）；
 * 不带 id 时新建，未写的能力与参数按模型 ID 和供应商协议推断默认值。
 * 未知字段直接报错，避免拼错的字段被静默忽略。
 */
export const modelConfigEntrySchema = modelUpdateSchema
  .omit({ routes: true, groupId: true, sort: true })
  .extend({
    id: z.string().trim().min(1).optional(),
    /** 分组名称；不存在时导入会新建同名分组，null 表示移出分组。 */
    group: modelGroupNameSchema.nullable().optional(),
    routes: z
      .array(modelConfigRouteSchema)
      .min(1, '至少需要一条线路')
      .max(MODEL_ROUTE_MAX_COUNT, `单个模型最多 ${MODEL_ROUTE_MAX_COUNT} 条线路`)
      .optional(),
  })
  .strict()

/** 外层只校验格式与数量；各模型逐条校验，便于在预览中逐项报告问题。 */
export const modelConfigDocumentSchema = z.object({
  format: z.literal(MODEL_CONFIG_FORMAT, { message: `format 必须是 "${MODEL_CONFIG_FORMAT}"` }),
  version: z.literal(MODEL_CONFIG_VERSION, { message: `version 必须是 ${MODEL_CONFIG_VERSION}` }),
  models: z
    .array(z.unknown())
    .min(1, '没有要导入的模型')
    .max(MODEL_CONFIG_MAX_MODELS, `单次最多导入 ${MODEL_CONFIG_MAX_MODELS} 个模型`),
})

export const modelConfigImportSchema = z.object({ document: z.unknown() })

export type ModelConfigRouteEntry = z.infer<typeof modelConfigRouteSchema>
export type ModelConfigEntry = z.infer<typeof modelConfigEntrySchema>

/**
 * 交给 AI 生成或修改配置时附带的格式说明。管理端「复制给 AI 的说明」与文档共用这一份，
 * 保证说明与实际校验一致。
 */
export const MODEL_CONFIG_AI_GUIDE = `你要生成一份 HappyChat 模型配置 JSON，用于管理后台「导入配置」。规则：

1. 顶层：{"format":"${MODEL_CONFIG_FORMAT}","version":${MODEL_CONFIG_VERSION},"models":[...]}。providers、groups、exportedAt 只是参考信息，导入时忽略。
2. 每个模型：
   - 带 "id"（来自导出文件）= 只更新你写出的字段，没写的字段保持不变；不带 "id" = 新建模型。
   - 新建时必填 "modelId"（规范模型 ID，例如 gpt-5.5）与 "routes"；"displayName" 缺省等于 modelId；能力、默认参数、思考等级缺省按模型 ID 与供应商协议自动推断。
   - "group"：分组名称，不存在会自动新建；null 表示不分组。
   - 不要写任何未列出的字段，未知字段会被拒绝。
3. 线路 "routes"（出现即整体替换该模型的全部线路）：
   - "provider"：供应商名称或 ID，必须是已存在的供应商（见导出文件的 providers）。
   - "upstreamModelId"：发给该供应商的 model 字段，缺省沿用 modelId。
   - "priority"：0–99，越大越先使用；同一优先级按 "weight"（1–100）分配流量。
   - "enabled"：是否启用该线路。
   - "costPricing"：该线路的上游真实成本价；null 或缺省 = 与用户计价相同。
   - 保留导出文件里线路的 "id" 可以保留历史统计归属。
4. 价格（"pricing" 是用户计价，用于额度与用户可见金额；"costPricing" 是成本价，仅管理员可见）：
   - 单位：所选币种每 100 万 Token。字段：currency（"USD" 或 "CNY"，缺省 USD）、input、output、cachedInput（缓存读取，缺省等于 input）、cacheWriteInput（缓存写入，缺省 0）。
   - 长上下文："contextTiers":[{"aboveInputTokens":200000,"input":..,"output":..}]，单次输入严格超过阈值时整次按该档计价。
   - 分时："timezone":"Asia/Shanghai","periods":[{"id":"night","label":"夜间","weekdays":[1,2,3,4,5,6,7],"start":"00:30","end":"08:30","pricing":{...同上价目表}}]，时段不能重叠。
   - 生图："imageGeneration" 三选一：{"mode":"per_image","price":0.04,"tiers":[{"size":"1024x1024","quality":"high","price":0.17}]}、{"mode":"per_request","price":0.05}、{"mode":"tokens","textInput":..,"imageInput":..,"imageOutput":..}。
   - 价格必须是非负数字；0 表示免费，不要用字符串。
5. 只输出 JSON 本身，不要附加解释或 Markdown 代码围栏。`
