import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { mergePreferences } from '@shared/util/preferences'
import { userPreferencesPatchSchema } from '@shared/schemas/settings'

describe('智能消息时间默认值迁移', () => {
  it('服务启动迁移覆盖所有旧格式、保留其他偏好，并且以后重启不覆盖新选择', () => {
    const temporaryRoot = resolve('.tmp')
    mkdirSync(temporaryRoot, { recursive: true })
    const migrationsFolder = mkdtempSync(join(temporaryRoot, 'smart-message-time-'))
    const sqlite = new Database(':memory:')
    try {
      mkdirSync(join(migrationsFolder, 'meta'))
      copyFileSync(
        new URL('./migrations/0057_smart_message_time.sql', import.meta.url),
        join(migrationsFolder, '0057_smart_message_time.sql'),
      )
      const journal = JSON.parse(
        readFileSync(new URL('./migrations/meta/_journal.json', import.meta.url), 'utf8'),
      ) as { entries: { tag: string; when: number; version: string; breakpoints: boolean }[] }
      const entry = journal.entries.find((item) => item.tag === '0057_smart_message_time')!
      expect(entry).toBeDefined()
      writeFileSync(
        join(migrationsFolder, 'meta/_journal.json'),
        JSON.stringify({
          version: '7',
          dialect: 'sqlite',
          entries: [{ ...entry, idx: 0 }],
        }),
      )
      sqlite.exec(
        'CREATE TABLE user_settings (user_id TEXT PRIMARY KEY, theme TEXT, ui_prefs TEXT)',
      )
      const previous = [
        null,
        {},
        { messageTimeFormat: 'time', showMessageTime: false, accentColor: 'purple' },
        {
          messageTimeFormat: 'datetime',
          messageFontSize: 'large',
          contextPolicy: { historyTurns: 4 },
        },
      ]
      const insert = sqlite.prepare('INSERT INTO user_settings VALUES (?, ?, ?)')
      previous.forEach((preferences, index) =>
        insert.run(
          String(index),
          'dark',
          preferences === null ? null : JSON.stringify(preferences),
        ),
      )
      const db = drizzle(sqlite)
      migrate(db, { migrationsFolder })
      const rows = sqlite
        .prepare('SELECT theme, ui_prefs FROM user_settings ORDER BY user_id')
        .all() as { theme: string; ui_prefs: string }[]
      rows.forEach((row, index) => {
        expect(row.theme).toBe('dark')
        expect(JSON.parse(row.ui_prefs)).toEqual({ ...previous[index], messageTimeFormat: 'smart' })
      })
      sqlite.exec(
        "UPDATE user_settings SET ui_prefs = json_set(ui_prefs, '$.messageTimeFormat', 'time') WHERE user_id = '2'",
      )
      migrate(db, { migrationsFolder })
      expect(
        sqlite
          .prepare(
            "SELECT json_extract(ui_prefs, '$.messageTimeFormat') AS format FROM user_settings WHERE user_id = '2'",
          )
          .get(),
      ).toEqual({ format: 'time' })
    } finally {
      sqlite.close()
      // 只清理本测试在仓库 .tmp 下创建的目录。
      if (dirname(migrationsFolder) === temporaryRoot) rmSync(migrationsFolder, { recursive: true })
    }
  })

  it('新账号和未存偏好的账号默认智能，同时允许用户再次选择其他格式', () => {
    expect(mergePreferences(null).messageTimeFormat).toBe('smart')
    expect(mergePreferences({}).messageTimeFormat).toBe('smart')
    for (const format of ['smart', 'time', 'datetime'] as const) {
      expect(
        userPreferencesPatchSchema.parse({ messageTimeFormat: format }).messageTimeFormat,
      ).toBe(format)
      expect(mergePreferences({ messageTimeFormat: format }).messageTimeFormat).toBe(format)
    }
  })
})
