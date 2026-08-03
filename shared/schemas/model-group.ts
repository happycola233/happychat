import { z } from 'zod'
import {
  CUSTOM_ICON_ID_PATTERN,
  CUSTOM_ICON_NAME_MAX_LENGTH,
  LOBE_ICON_SLUG_PATTERN,
} from '../util/modelIcon'

/**
 * 模型 / 分组图标。三种来源共用一个可辨识联合，`null` 表示未配置
 * （模型会退回按 modelId 自动识别，分组退回默认文件夹图形）。
 *
 * 校验规则与 `shared/util/modelIcon.ts` 的 normalize 共用同一组常量，
 * 保证「写入时校验」与「读取时归一化」不会漂移。
 */
export const modelIconSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('lobe'),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(LOBE_ICON_SLUG_PATTERN, '内置图标标识不合法'),
  }),
  z.object({
    type: z.literal('custom'),
    id: z.string().trim().toLowerCase().regex(CUSTOM_ICON_ID_PATTERN, '自定义图标标识不合法'),
  }),
  z.object({
    type: z.literal('emoji'),
    // 与聊天文件夹同规则：恰好一个字素簇（放行 ZWJ 组合 emoji 与单个汉字）。
    char: z
      .string()
      .trim()
      .min(1)
      .max(20, '图标格式不正确')
      .refine(
        (value) => [...new Intl.Segmenter().segment(value)].length === 1,
        '图标只能是单个表情',
      ),
  }),
])

/** 默认分组文件夹图形的颜色：仅接受 #RRGGBB。 */
export const modelGroupColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, '颜色格式不正确')
  .transform((color) => color.toLowerCase())

export const modelGroupNameSchema = z
  .string()
  .trim()
  .min(1, '请输入分组名称')
  .max(40, '分组名称最长 40 字')

export const modelGroupCreateSchema = z.object({
  name: modelGroupNameSchema,
  icon: modelIconSchema.nullish(),
  color: modelGroupColorSchema.nullish(),
})

/** 更新分组：字段全部可选；图标传 null 恢复文件夹图形，颜色传 null 恢复默认黄色。 */
export const modelGroupUpdateSchema = z
  .object({
    name: modelGroupNameSchema.optional(),
    icon: modelIconSchema.nullable().optional(),
    color: modelGroupColorSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '没有需要更新的内容' })

/** 拖拽排序后一次性提交完整顺序，语义与 modelReorderSchema 一致。 */
export const modelGroupReorderSchema = z.object({
  groupIds: z
    .array(z.string().min(1))
    .min(1, '请选择要排序的分组')
    .refine((ids) => new Set(ids).size === ids.length, '分组顺序不能包含重复项'),
})

/** 单次批量指派的模型数量上限（管理端一屏最多也就几百个模型）。 */
export const MODEL_GROUP_ASSIGN_LIMIT = 1000

/** 批量把模型移入某个分组；groupId=null 表示移出分组。 */
export const modelGroupAssignSchema = z.object({
  groupId: z.string().min(1).nullable(),
  modelIds: z
    .array(z.string().min(1))
    .min(1, '请选择要移动的模型')
    .max(MODEL_GROUP_ASSIGN_LIMIT, '单次最多移动 1000 个模型')
    .refine((ids) => new Set(ids).size === ids.length, '模型列表不能包含重复项'),
})

/** 批量套用图标（管理端「批量识别图标」确认后提交的差异集）。 */
export const modelIconBatchSchema = z.object({
  items: z
    .array(z.object({ id: z.string().min(1), icon: modelIconSchema.nullable() }))
    .min(1, '没有需要更新的图标')
    .max(MODEL_GROUP_ASSIGN_LIMIT, '单次最多更新 1000 个模型')
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      '模型列表不能包含重复项',
    ),
})

/** 自定义图标上传时的显示名（表单字段，文件本身走 multipart）。 */
export const customIconNameSchema = z
  .string()
  .trim()
  .min(1, '请填写图标名称')
  .max(CUSTOM_ICON_NAME_MAX_LENGTH, `图标名称最长 ${CUSTOM_ICON_NAME_MAX_LENGTH} 字`)

export type ModelGroupCreateInput = z.infer<typeof modelGroupCreateSchema>
export type ModelGroupUpdateInput = z.infer<typeof modelGroupUpdateSchema>
export type ModelGroupReorderInput = z.infer<typeof modelGroupReorderSchema>
export type ModelGroupAssignInput = z.infer<typeof modelGroupAssignSchema>
export type ModelIconBatchInput = z.infer<typeof modelIconBatchSchema>
