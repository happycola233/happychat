import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { RetryPolicy } from '@shared/schemas/retry'

const migration = readFileSync(
  new URL('./migrations/0047_retry_cloudflare_timeout.sql', import.meta.url),
  'utf8',
)

describe('524 超时重试配置迁移', () => {
  it('只为已选择 504 的配置补齐 524，保留总开关、参数和其他错误选择', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec('CREATE TABLE app_settings (id text PRIMARY KEY, upstream_retry text)')
      const policies: Record<
        string,
        (Partial<RetryPolicy> & Pick<RetryPolicy, 'retryStatusCodes'>) | null
      > = {
        defaults: {
          enabled: true,
          maxRetries: 3,
          retryStatusCodes: [408, 409, 429, 500, 502, 503, 504, 529],
        },
        disabled: { enabled: false, retryStatusCodes: [504] },
        custom: { enabled: true, initialDelaySeconds: 15, retryStatusCodes: [429, 504] },
        rateLimitOnly: { enabled: true, retryStatusCodes: [429] },
        none: { enabled: true, retryStatusCodes: [] },
        alreadyIncluded: { enabled: true, retryStatusCodes: [504, 524] },
        missing: null,
      }
      const insert = sqlite.prepare('INSERT INTO app_settings VALUES (?, ?)')
      for (const [id, policy] of Object.entries(policies)) {
        insert.run(id, policy ? JSON.stringify(policy) : null)
      }
      sqlite.exec(migration)
      // SQL 本身也保持幂等，避免重复追加状态码。
      sqlite.exec(migration)
      const rows = sqlite.prepare('SELECT id, upstream_retry FROM app_settings').all() as {
        id: keyof typeof policies
        upstream_retry: string | null
      }[]
      for (const row of rows) {
        const previous = policies[row.id]
        const expected =
          previous?.retryStatusCodes.includes(504) && !previous.retryStatusCodes.includes(524)
            ? { ...previous, retryStatusCodes: [...previous.retryStatusCodes, 524] }
            : previous
        expect(row.upstream_retry ? JSON.parse(row.upstream_retry) : null).toEqual(expected)
      }
    } finally {
      sqlite.close()
    }
  })
})
