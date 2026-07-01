/** 系统提示词可用变量（UI 图例与渲染共用的单一事实源）。 */
export const PROMPT_VARIABLES: {
  name: string
  description: string
  /** 每轮都会变化，放入顶层系统提示词会降低精确前缀缓存命中率。 */
  cacheVolatile?: boolean
}[] = [
  { name: 'current_date', description: '当前日期，如 2026-06-20', cacheVolatile: true },
  {
    name: 'current_time',
    description: '当前时间（24 小时制），如 14:30',
    cacheVolatile: true,
  },
  {
    name: 'current_datetime',
    description: '当前日期时间，如 2026-06-20 14:30:00',
    cacheVolatile: true,
  },
  {
    name: 'iso_datetime',
    description: 'ISO 8601 UTC 时间，如 2026-06-20T06:30:00.000Z',
    cacheVolatile: true,
  },
  { name: 'current_year', description: '当前年份，如 2026', cacheVolatile: true },
  {
    name: 'current_weekday',
    description: '星期几（英文），如 Friday',
    cacheVolatile: true,
  },
  { name: 'current_user', description: '当前用户的显示名（无则用户名）' },
  { name: 'current_username', description: '当前用户名' },
  { name: 'locale', description: '浏览器语言，如 简体中文' },
  { name: 'model_name', description: '模型外显名称' },
  { name: 'model_id', description: '模型真实 ID' },
  { name: 'timezone', description: '服务器时区，如 Asia/Shanghai', cacheVolatile: true },
]

/**
 * 渲染提示词模板：把 `{{ name }}`（容忍内部空格）替换为 vars 中的值；
 * 未知变量原样保留，避免误删用户文本。
 */
export function renderPromptTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) =>
    key in vars ? vars[key]! : match,
  )
}
