import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(
  new URL('./migrations/0044_request_generated_images.sql', import.meta.url),
)

function createLegacyDatabase() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(`
    CREATE TABLE conversations (id text PRIMARY KEY);
    CREATE TABLE runs (
      id text PRIMARY KEY,
      conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      assistant_message_id text
    );
    CREATE TABLE messages (
      id text PRIMARY KEY,
      conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      run_id text,
      role text NOT NULL,
      content text NOT NULL
    );
    CREATE TABLE attachments (
      id text PRIMARY KEY,
      message_id text,
      kind text NOT NULL,
      filename text NOT NULL
    );
    CREATE TABLE run_events (
      run_id text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      type text NOT NULL,
      data text NOT NULL
    );
    CREATE TABLE usage_logs (
      id text PRIMARY KEY,
      run_id text REFERENCES runs(id) ON DELETE SET NULL,
      conversation_id text,
      kind text NOT NULL DEFAULT 'chat'
    );

    INSERT INTO conversations VALUES ('original'), ('branch'), ('without-final');
    INSERT INTO runs VALUES
      ('generated-run', 'original', 'original-assistant'),
      ('preview-only-run', 'without-final', 'preview-only-assistant'),
      ('missing-assistant-run', 'original', 'deleted-assistant');
    INSERT INTO usage_logs (id, run_id, conversation_id) VALUES
      ('generated', 'generated-run', 'original'),
      ('preview-only', 'preview-only-run', 'without-final'),
      ('missing-assistant', 'missing-assistant-run', 'original'),
      ('without-run', null, 'original');
    INSERT INTO attachments VALUES
      ('final-a', 'original-assistant', 'image', 'image-a.png'),
      ('final-b', 'original-assistant', 'image', 'image-b.png'),
      ('partial-preview', 'original-assistant', 'image', 'partial-image-1-0.png'),
      ('unfinished-preview', 'preview-only-assistant', 'image', 'partial-image-1-0.png'),
      ('reference-image', 'original-assistant', 'image', 'reference.png');
  `)

  const insertMessage = sqlite.prepare(
    'INSERT INTO messages (id, conversation_id, run_id, role, content) VALUES (?, ?, ?, ?, ?)',
  )
  insertMessage.run(
    'original-assistant',
    'original',
    'generated-run',
    'assistant',
    JSON.stringify([
      { type: 'output_text', text: '两张测试生成图' },
      { type: 'image_result', attachment_id: 'final-a' },
      { type: 'image_result', attachment_id: 'final-a' },
      { type: 'image_result', attachment_id: 'final-b' },
      { type: 'input_image', attachment_id: 'reference-image' },
    ]),
  )
  // 分支拥有自己的附件副本，即使保留同一 run_id，也不能参与原请求的产图计数。
  insertMessage.run(
    'branch-assistant',
    'branch',
    'generated-run',
    'assistant',
    JSON.stringify([
      { type: 'image_result', attachment_id: 'branch-copy-a' },
      { type: 'image_result', attachment_id: 'branch-copy-b' },
    ]),
  )
  insertMessage.run(
    'preview-only-assistant',
    'without-final',
    'preview-only-run',
    'assistant',
    JSON.stringify([{ type: 'input_image', attachment_id: 'reference-image' }]),
  )
  const insertEvent = sqlite.prepare('INSERT INTO run_events (run_id, type, data) VALUES (?, ?, ?)')
  insertEvent.run(
    'generated-run',
    'image.generation.partial',
    JSON.stringify({ attachmentId: 'partial-preview', partialIndex: 0 }),
  )
  insertEvent.run(
    'preview-only-run',
    'image.generation.partial',
    JSON.stringify({ attachmentId: 'unfinished-preview', partialIndex: 0 }),
  )
  return sqlite
}

function applyMigration(sqlite: Database.Database) {
  sqlite.exec(readFileSync(migrationPath, 'utf8').replaceAll('--> statement-breakpoint', ''))
}

describe('request generated image count migration', () => {
  it('counts distinct final images from the original assistant without including inputs, previews or branch copies', () => {
    const sqlite = createLegacyDatabase()
    try {
      applyMigration(sqlite)
      const rows = sqlite
        .prepare(
          `SELECT id, generated_image_count AS generatedImageCount
           FROM usage_logs ORDER BY id`,
        )
        .all()
      expect(rows).toEqual([
        { id: 'generated', generatedImageCount: 2 },
        { id: 'missing-assistant', generatedImageCount: 0 },
        { id: 'preview-only', generatedImageCount: 0 },
        { id: 'without-run', generatedImageCount: 0 },
      ])

      sqlite.prepare('INSERT INTO usage_logs (id) VALUES (?)').run('new-default')
      expect(
        sqlite
          .prepare('SELECT generated_image_count FROM usage_logs WHERE id = ?')
          .get('new-default'),
      ).toEqual({ generated_image_count: 0 })
      expect(() =>
        sqlite
          .prepare('INSERT INTO usage_logs (id, generated_image_count) VALUES (?, ?)')
          .run('invalid-null', null),
      ).toThrow(/NOT NULL/)
    } finally {
      sqlite.close()
    }
  })

  it.each([
    ['assistant message', "DELETE FROM messages WHERE id = 'original-assistant'", 'generated-run'],
    ['run', "DELETE FROM runs WHERE id = 'generated-run'", null],
    ['conversation', "DELETE FROM conversations WHERE id = 'original'", null],
  ] as const)(
    'retains the audit count after deleting the original %s',
    (_name, deletion, runId) => {
      const sqlite = createLegacyDatabase()
      try {
        applyMigration(sqlite)
        sqlite.exec(deletion)
        expect(
          sqlite
            .prepare(
              `SELECT run_id AS runId, generated_image_count AS generatedImageCount
             FROM usage_logs WHERE id = 'generated'`,
            )
            .get(),
        ).toEqual({ runId, generatedImageCount: 2 })
      } finally {
        sqlite.close()
      }
    },
  )
})
