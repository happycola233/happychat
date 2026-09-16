import { z } from 'zod'

const TRANSPORT_HEADERS = new Set([
  'host',
  'content-length',
  'content-type',
  'connection',
  'transfer-encoding',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
])

/** 请求头属于外部输入；阻止换行注入、重复名称和破坏 JSON 传输的字段。 */
export const providerHeadersSchema = z
  .record(z.string(), z.string())
  .superRefine((headers, ctx) => {
    if (Object.keys(headers).length > 32) {
      ctx.addIssue({ code: 'custom', message: '最多添加 32 个请求头' })
    }
    const seen = new Set<string>()
    for (const [name, value] of Object.entries(headers)) {
      const lowerName = name.toLowerCase()
      let message: string | undefined
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name))
        message = `请求头名称「${name}」格式不正确`
      else if (TRANSPORT_HEADERS.has(lowerName))
        message = `${name} 由系统自动设置，请使用其他请求头`
      else if (seen.has(lowerName)) message = `请求头「${name}」重复（名称不区分大小写）`
      else if (value.length > 8192 || /[^\t\x20-\x7e\x80-\xff]/.test(value))
        message = `请求头「${name}」的值不能包含换行、控制字符或非 Latin-1 字符，且不能超过 8192 字符`
      if (message) ctx.addIssue({ code: 'custom', path: [name], message })
      seen.add(lowerName)
    }
  })
