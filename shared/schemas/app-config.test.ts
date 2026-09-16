import { describe, expect, it } from 'vitest'
import { appConfigUpdateSchema } from './app-config'

describe('额度提示文案配置', () => {
  it.each(['quotaWarningMessage', 'quotaExhaustedMessage'] as const)('%s 支持留空和清空', (key) => {
    for (const value of [null, '', '  \n ']) {
      expect(appConfigUpdateSchema.parse({ [key]: value })).toEqual({ [key]: null })
    }
    expect(appConfigUpdateSchema.parse({ [key]: '  联系管理员  ' })).toEqual({
      [key]: '联系管理员',
    })
    expect(appConfigUpdateSchema.safeParse({ [key]: '字'.repeat(2001) }).success).toBe(false)
  })

  it('未提交的文案保持缺省，以便只更新其他设置', () => {
    expect(appConfigUpdateSchema.parse({ sharingEnabled: false })).toEqual({
      sharingEnabled: false,
    })
  })
})
