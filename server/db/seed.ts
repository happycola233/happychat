import { eq } from 'drizzle-orm'
import { env } from '../env'
import { encryptSecret } from '../lib/crypto'
import { must } from '../lib/assert'
import { syncProviderModels } from '../services/providers'
import { db } from './client'
import { runMigrations } from './migrate'
import { providers } from './schema'

/**
 * 可选的数据库 seed：确保已迁移；若设置了 UPSTREAM_BASE_URL / UPSTREAM_API_KEY，
 * 则幂等地预置一个上游 Provider 并同步模型（方便部署后开箱即用）。
 * 不设置这两个变量时只确保数据库就绪。用户初始化仍走「首位注册者自动成为管理员」。
 */
async function main(): Promise<void> {
  runMigrations()
  console.log('数据库已就绪。')

  const baseUrl = env.UPSTREAM_BASE_URL
  const apiKey = env.UPSTREAM_API_KEY
  if (!baseUrl || !apiKey) {
    console.log(
      '未设置 UPSTREAM_BASE_URL / UPSTREAM_API_KEY，跳过 Provider 预置（可在管理后台手动添加）。',
    )
    return
  }

  const existing = (
    await db.select().from(providers).where(eq(providers.baseUrl, baseUrl)).limit(1)
  ).at(0)

  const provider =
    existing ??
    must(
      await db
        .insert(providers)
        .values({ name: '默认上游', baseUrl, apiKeyEncrypted: encryptSecret(apiKey) })
        .returning()
        .then((r) => r[0]),
    )
  console.log(
    existing
      ? `Provider 已存在（${provider.name} @ ${provider.baseUrl}），仅同步模型。`
      : `已创建 Provider：${provider.name} @ ${provider.baseUrl}`,
  )

  const result = await syncProviderModels(provider)
  console.log(`同步模型完成：新增 ${result.added}，共 ${result.total}。`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('seed 失败：', e instanceof Error ? e.message : e)
    process.exit(1)
  })
