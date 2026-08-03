import { DEFAULT_FOLDER_COLOR } from '@shared/constants'

/** 自动模型标签五种色调对应的手动选择值。 */
export const MODEL_TAG_TONE_COLORS = {
  sky: '#0ea5e9',
  violet: '#8b5cf6',
  amber: '#f59e0b',
  emerald: '#10b981',
  rose: '#f43f5e',
} as const

/** 模型标签固定色预设；与自动配色使用同一组高对比色调。 */
export const MODEL_TAG_COLOR_PRESETS = [
  '#ef4444', // red
  '#f97316', // orange
  MODEL_TAG_TONE_COLORS.amber,
  '#22c55e', // green
  MODEL_TAG_TONE_COLORS.emerald,
  '#14b8a6', // teal
  MODEL_TAG_TONE_COLORS.sky,
  '#3b82f6', // blue
  MODEL_TAG_TONE_COLORS.violet,
  '#d946ef', // fuchsia
  '#ec4899', // pink
  MODEL_TAG_TONE_COLORS.rose,
] as const

/**
 * 聊天文件夹与模型分组共用的柔和浅色预设。
 *
 * 色相按暖色到冷色排列，明度保持在相近区间，避免混入模型标签所需的高饱和深色。
 * 柔和黄色同时作为默认选项，旧的自定义颜色仍会原样保留。
 */
export const FOLDER_COLOR_PRESETS = [
  '#ffb3b3', // 浅红
  '#ffc49b', // 蜜桃橙
  DEFAULT_FOLDER_COLOR, // 默认浅黄
  '#dce98f', // 浅青柠
  '#aee3a1', // 浅绿
  '#92ddc4', // 薄荷绿
  '#8fdde8', // 浅青
  '#9dceff', // 浅蓝
  '#b9c2ff', // 淡靛蓝
  '#d1b5f5', // 薰衣草紫
  '#edb6ea', // 淡紫红
  '#f7b5d0', // 浅粉
] as const

/** 文件夹自定义取色入口使用的粉彩渐变；与模型标签的高饱和入口刻意分开。 */
export const FOLDER_CUSTOM_COLOR_SWATCH_BACKGROUND = `conic-gradient(#ffb3b3, ${DEFAULT_FOLDER_COLOR}, #aee3a1, #8fdde8, #b9c2ff, #d1b5f5, #f7b5d0, #ffb3b3)`

/** 粉彩渐变上吸管图标的灰紫色；比纯黑柔和，同时保留足够轮廓。 */
export const FOLDER_CUSTOM_COLOR_SWATCH_ICON_COLOR = '#6f6a86'

/** 打开文件夹自定义取色器时使用的柔和起始色；刻意不与预设色重复。 */
export const FOLDER_CUSTOM_COLOR_SEED = '#7eb8f7'
