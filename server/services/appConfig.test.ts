import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let temporaryDirectory: string
let dbClient: typeof import('../db/client')
let appConfigService: typeof import('./appConfig')

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'happychat-app-config-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = temporaryDirectory
  process.env.DATABASE_URL = join(temporaryDirectory, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-app-config'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  appConfigService = await import('./appConfig')
  migration.runMigrations()
})

beforeEach(() => {
  dbClient.sqlite.exec('DELETE FROM app_settings')
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('全局应用配置', () => {
  it('保存提醒文案和上下文阈值，局部修改不丢失已保存的提示', async () => {
    const initial = await appConfigService.getAppConfig()
    expect(initial.quotaWarningMessage).toBeNull()
    expect(initial.quotaExhaustedMessage).toBeNull()
    expect(initial.contextOptimizationSuggestion).toEqual({ enabled: true, tokenThreshold: 100000 })
    await appConfigService.updateAppConfig({
      quotaWarningMessage: '额度快用完时请联系管理员。',
      quotaExhaustedMessage: '需要更多额度时请联系管理员。',
      contextOptimizationSuggestion: { enabled: false, tokenThreshold: 16000 },
    })
    await appConfigService.updateAppConfig({ sharingEnabled: false })
    const saved = await appConfigService.getAppConfig()
    expect(saved.quotaWarningMessage).toBe('额度快用完时请联系管理员。')
    expect(saved.quotaExhaustedMessage).toBe('需要更多额度时请联系管理员。')
    expect(saved.contextOptimizationSuggestion).toEqual({ enabled: false, tokenThreshold: 16000 })
    await appConfigService.updateAppConfig({
      quotaWarningMessage: null,
      quotaExhaustedMessage: null,
    })
    const cleared = await appConfigService.getAppConfig()
    expect(cleared.quotaWarningMessage).toBeNull()
    expect(cleared.quotaExhaustedMessage).toBeNull()
  })

  it('新部署默认要求邀请码并展示消息成本', async () => {
    const config = await appConfigService.getAppConfig()

    expect(config.registrationRequiresInviteCode).toBe(true)
    expect(config.showCost).toBe(true)
    expect(config.costCurrency).toBe('USD')
  })

  it('可关闭并持久化，其他字段的局部更新不会重置注册策略', async () => {
    await appConfigService.updateAppConfig({ registrationRequiresInviteCode: false })
    await appConfigService.updateAppConfig({ sharingEnabled: false })

    const config = await appConfigService.getAppConfig()
    expect(config.registrationRequiresInviteCode).toBe(false)
    expect(config.sharingEnabled).toBe(false)
  })

  it('可独立关闭消息成本展示', async () => {
    await appConfigService.updateAppConfig({ showCost: false })
    await appConfigService.updateAppConfig({ sharingEnabled: false })

    const config = await appConfigService.getAppConfig()
    expect(config.showCost).toBe(false)
  })

  it('可把聊天消息成本币种切换为 CNY，其他更新不会重置', async () => {
    await appConfigService.updateAppConfig({ costCurrency: 'CNY' })
    await appConfigService.updateAppConfig({ sharingEnabled: false })

    const config = await appConfigService.getAppConfig()
    expect(config.costCurrency).toBe('CNY')
  })
})
