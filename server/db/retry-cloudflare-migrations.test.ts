import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { RetryPolicy } from '@shared/schemas/retry'

describe.each([
  { status: 520, relatedStatus: 502, migrationName: '0048_retry_cloudflare_unknown_error.sql' },
  { status: 524, relatedStatus: 504, migrationName: '0047_retry_cloudflare_timeout.sql' },
])('$status 重试配置迁移', ({ status, relatedStatus, migrationName }) => {
  it('只为已选择对应网关错误的配置补齐状态码，保留总开关、参数和其他错误选择', () => {
    const migration = readFileSync(
      new URL(`./migrations/${migrationName}`, import.meta.url),
      'utf8',
    )
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
        disabled: { enabled: false, retryStatusCodes: [relatedStatus] },
        custom: { enabled: true, initialDelaySeconds: 15, retryStatusCodes: [429, relatedStatus] },
        rateLimitOnly: { enabled: true, retryStatusCodes: [429] },
        internalErrorOnly: { enabled: true, retryStatusCodes: [500] },
        none: { enabled: true, retryStatusCodes: [] },
        alreadyIncluded: { enabled: true, retryStatusCodes: [relatedStatus, status] },
        standalone: { enabled: true, retryStatusCodes: [status] },
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
        const expected = ['defaults', 'disabled', 'custom'].includes(row.id)
          ? { ...previous, retryStatusCodes: [...previous!.retryStatusCodes, status] }
          : previous
        expect(row.upstream_retry ? JSON.parse(row.upstream_retry) : null).toEqual(expected)
      }
    } finally {
      sqlite.close()
    }
  })
})
