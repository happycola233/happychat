/** 自动模型标签五种色调对应的手动选择值。 */
export const MODEL_TAG_TONE_COLORS = {
  sky: '#0ea5e9',
  violet: '#8b5cf6',
  amber: '#f59e0b',
  emerald: '#10b981',
  rose: '#f43f5e',
} as const

/** 通用自定义主题色预设；取 Tailwind 500 档，文件夹与模型标签共用。 */
export const COLOR_PRESETS = [
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
