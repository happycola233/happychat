import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

describe('0059 Artifacts capability migration', () => {
  it('enables Artifacts for existing text models once and keeps explicit choices', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec('CREATE TABLE models (id TEXT PRIMARY KEY, kind TEXT, capabilities TEXT)')
      const insert = sqlite.prepare('INSERT INTO models VALUES (?,?,?)')
      insert.run('responses', 'responses', '{"vision":true}')
      insert.run('chat', 'chat', '{}')
      insert.run('anthropic', 'anthropic', '{"reasoning":true}')
      insert.run('image', 'image', '{"image_generation":true}')
      insert.run('opted-out', 'responses', '{"artifacts":false}')

      const migration = readFileSync(
        resolve('server/db/migrations/0059_artifacts_capability.sql'),
        'utf8',
      )
      sqlite.exec(migration)
      sqlite.exec(migration)

      const capabilities = Object.fromEntries(
        (
          sqlite.prepare('SELECT id, capabilities FROM models').all() as {
            id: string
            capabilities: string
          }[]
        ).map((row) => [row.id, JSON.parse(row.capabilities)]),
      )
      expect(capabilities).toEqual({
        responses: { vision: true, artifacts: true },
        chat: { artifacts: true },
        anthropic: { reasoning: true, artifacts: true },
        image: { image_generation: true },
        'opted-out': { artifacts: false },
      })
    } finally {
      sqlite.close()
    }
  })
})
