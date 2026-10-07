import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

describe('0050 Anthropic defaults migration', () => {
  it('升级旧预设及不再支持的思考档位，保留自定义配置并可重复执行', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec(`CREATE TABLE models (
        id TEXT PRIMARY KEY, model_id TEXT, kind TEXT, default_params TEXT, hard_params TEXT,
        allowed_efforts TEXT, default_effort TEXT, capabilities TEXT
      )`)
      const insert = sqlite.prepare('INSERT INTO models VALUES (?,?,?,?,?,?,?,?)')
      const tools = [{ type: 'web_search_20250305', name: 'web_search' }]
      const efforts = [
        { value: 'none', description: '关闭' },
        { value: 'medium', description: '中' },
        { value: 'max', description: '最高' },
      ]
      for (const [id, modelId] of [
        ['opus', 'claude-opus-5-5'],
        ['sonnet', 'claude-sonnet-5-5'],
        ['haiku', 'claude-haiku-4-5'],
        ['legacy', 'claude-opus-4-1-20250805'],
      ]) {
        insert.run(
          id,
          modelId,
          'anthropic',
          JSON.stringify({ max_output_tokens: 16000, reasoning_effort: 'none' }),
          JSON.stringify({ tools, cache_control: { type: 'ephemeral' } }),
          JSON.stringify(efforts),
          'none',
          '{"reasoning":false}',
        )
      }
      insert.run(
        'custom',
        'claude-opus-5-5',
        'anthropic',
        '{"max_output_tokens":9000}',
        JSON.stringify({ max_tokens: 8000, tools: [{ ...tools[0], max_uses: 2 }] }),
        '["none","max"]',
        'max',
        '{"reasoning":true}',
      )
      insert.run(
        'deleted',
        'claude-sonnet-5',
        'anthropic',
        '{"max_output_tokens":64000}',
        '{}',
        '["none","high"]',
        'high',
        '{}',
      )
      insert.run(
        'openai',
        'claude-opus-5-5',
        'responses',
        '{"max_output_tokens":16000}',
        JSON.stringify({ tools }),
        '["none","high"]',
        'none',
        '{}',
      )
      const migration = readFileSync(
        resolve('server/db/migrations/0050_anthropic_current_defaults.sql'),
        'utf8',
      )
      sqlite.exec(migration)
      const read = (id: string) => {
        const row = sqlite.prepare('SELECT * FROM models WHERE id=?').get(id) as Record<
          string,
          string
        >
        return {
          ...row,
          default_effort: row.default_effort,
          params: JSON.parse(row.default_params!),
          hard: JSON.parse(row.hard_params!),
          efforts: JSON.parse(row.allowed_efforts!),
          capabilities: JSON.parse(row.capabilities!),
        }
      }
      expect(read('opus')).toMatchObject({
        params: { max_output_tokens: 128000 },
        default_effort: 'medium',
        capabilities: { reasoning: true },
      })
      expect(read('opus').params).not.toHaveProperty('reasoning_effort')
      expect(read('opus').efforts).toEqual(efforts.slice(1))
      expect(read('opus').hard.tools).toEqual([{ type: 'web_search_20260318', name: 'web_search' }])
      expect(read('sonnet').efforts[0]).toEqual({
        value: 'between_tools',
        description: '仅工具间思考',
      })
      expect(read('sonnet').default_effort).toBe('between_tools')
      expect(read('haiku').params.max_output_tokens).toBe(64000)
      expect(read('legacy').params.max_output_tokens).toBe(32000)
      expect(read('haiku').hard.tools[0].allowed_callers).toEqual(['direct'])
      expect(read('custom')).toMatchObject({
        params: { max_output_tokens: 9000 },
        hard: { max_tokens: 8000, tools: [{ type: 'web_search_20250305', max_uses: 2 }] },
        efforts: ['max'],
        default_effort: 'max',
      })
      expect(read('deleted').hard).toEqual({})
      expect(read('openai').params.max_output_tokens).toBe(16000)
      expect(read('openai').efforts).toEqual(['none', 'high'])
      const first = sqlite.prepare('SELECT * FROM models ORDER BY id').all()
      sqlite.exec(migration)
      expect(sqlite.prepare('SELECT * FROM models ORDER BY id').all()).toEqual(first)
    } finally {
      sqlite.close()
    }
  })
})

describe('0051 Anthropic direct search default migration', () => {
  it('只补充新版搜索缺失的调用方式，保留显式配置、其他工具与非 Anthropic 模型', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec('CREATE TABLE models (id TEXT PRIMARY KEY, kind TEXT, hard_params TEXT)')
      const search = { type: 'web_search_20260318', name: 'web_search', max_uses: 3 }
      const dynamicSearch = { ...search, allowed_callers: ['code_execution_20260120'] }
      const customTool = { name: 'custom_tool', input_schema: { type: 'object' } }
      const insert = sqlite.prepare('INSERT INTO models VALUES (?,?,?)')
      insert.run('default', 'anthropic', JSON.stringify({ tools: [search, customTool] }))
      insert.run(
        'previous',
        'anthropic',
        JSON.stringify({ tools: [{ ...search, type: 'web_search_20260209' }] }),
      )
      insert.run('dynamic', 'anthropic', JSON.stringify({ tools: [dynamicSearch] }))
      insert.run('deleted', 'anthropic', '{}')
      insert.run('other', 'responses', JSON.stringify({ tools: [search] }))
      const migration = readFileSync(
        resolve('server/db/migrations/0051_anthropic_direct_search_default.sql'),
        'utf8',
      )
      sqlite.exec(migration)
      const read = (id: string) =>
        JSON.parse(
          (
            sqlite.prepare('SELECT hard_params FROM models WHERE id=?').get(id) as {
              hard_params: string
            }
          ).hard_params,
        )
      expect(read('default').tools).toEqual([
        { ...search, allowed_callers: ['direct'] },
        customTool,
      ])
      expect(read('previous').tools[0]).toEqual({
        ...search,
        type: 'web_search_20260209',
        allowed_callers: ['direct'],
      })
      expect(read('dynamic').tools).toEqual([dynamicSearch])
      expect(read('deleted')).toEqual({})
      expect(read('other').tools).toEqual([search])
      const first = sqlite.prepare('SELECT * FROM models ORDER BY id').all()
      sqlite.exec(migration)
      expect(sqlite.prepare('SELECT * FROM models ORDER BY id').all()).toEqual(first)
    } finally {
      sqlite.close()
    }
  })
})
