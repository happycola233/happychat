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

describe('全局注册策略', () => {
  it('新部署默认要求邀请码', async () => {
    const config = await appConfigService.getAppConfig()

    expect(config.registrationRequiresInviteCode).toBe(true)
  })

  it('可关闭并持久化，其他字段的局部更新不会重置注册策略', async () => {
    await appConfigService.updateAppConfig({ registrationRequiresInviteCode: false })
    await appConfigService.updateAppConfig({ sharingEnabled: false })

    const config = await appConfigService.getAppConfig()
    expect(config.registrationRequiresInviteCode).toBe(false)
    expect(config.sharingEnabled).toBe(false)
  })
})
