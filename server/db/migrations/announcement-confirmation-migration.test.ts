import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

describe('0035 announcement confirmation migration', () => {
  it('keeps confirmed reads while removing legacy exposure rows and counters', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec(`
        PRAGMA foreign_keys=ON;
        CREATE TABLE users (id text PRIMARY KEY NOT NULL);
        CREATE TABLE announcements (
          id text PRIMARY KEY NOT NULL,
          max_impressions integer DEFAULT 1 NOT NULL
        );
        CREATE TABLE announcement_reads (
          announcement_id text NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
          user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          read_at integer,
          impressions integer DEFAULT 0 NOT NULL,
          PRIMARY KEY (announcement_id, user_id)
        );
        CREATE INDEX announcement_reads_user_idx ON announcement_reads(user_id);
        INSERT INTO users (id) VALUES ('dismissed'), ('confirmed');
        INSERT INTO announcements (id, max_impressions) VALUES ('announcement-1', 20);
        INSERT INTO announcement_reads (announcement_id, user_id, read_at, impressions)
        VALUES
          ('announcement-1', 'dismissed', NULL, 20),
          ('announcement-1', 'confirmed', 123, 3);
      `)

      const migration = readFileSync(
        resolve('server/db/migrations/0035_lively_the_enforcers.sql'),
        'utf8',
      )
      sqlite.exec(migration)

      const announcementColumns = sqlite
        .prepare("PRAGMA table_info('announcements')")
        .all() as Array<{ name: string }>
      const readColumns = sqlite.prepare("PRAGMA table_info('announcement_reads')").all() as Array<{
        name: string
        notnull: number
      }>
      const reads = sqlite
        .prepare(
          'SELECT announcement_id, user_id, read_at FROM announcement_reads ORDER BY user_id',
        )
        .all()

      expect(announcementColumns.map((column) => column.name)).not.toContain('max_impressions')
      expect(readColumns.map((column) => column.name)).not.toContain('impressions')
      expect(readColumns.find((column) => column.name === 'read_at')?.notnull).toBe(1)
      expect(reads).toEqual([
        { announcement_id: 'announcement-1', user_id: 'confirmed', read_at: 123 },
      ])
    } finally {
      sqlite.close()
    }
  })
})
