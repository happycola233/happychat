/**
 * 文件夹预设主题色（取 Tailwind 500 档，中等饱和度在浅/深色底上均可读）；
 * 自定义颜色走取色器，任意 #RRGGBB 均由 .hc-folder-glyph 的 color-mix 派生浅底/深字。
 */
export const FOLDER_COLOR_PRESETS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#22c55e', // green
  '#14b8a6', // teal
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
  '#ec4899', // pink
] as const
