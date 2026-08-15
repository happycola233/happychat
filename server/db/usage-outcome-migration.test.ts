import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(
  new URL('./migrations/0033_clever_thor_girl.sql', import.meta.url),
)

describe('usage outcome migration', () => {
  it('backfills terminal snapshots from runs and legacy success when no run remains', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec(`
        CREATE TABLE runs (
          id text PRIMARY KEY,
          state text NOT NULL,
          incomplete_reason text,
          error_code text
        );
        CREATE TABLE usage_logs (
          id text PRIMARY KEY,
          run_id text,
          success integer NOT NULL,
          error_type text,
          created_at integer NOT NULL
        );
        CREATE TABLE run_events (
          run_id text NOT NULL,
          sequence_number integer NOT NULL,
          type text NOT NULL,
          data text NOT NULL
        );

        INSERT INTO runs VALUES
          ('completed-run', 'completed', null, null),
          ('incomplete-run', 'incomplete', 'max_output_tokens', null),
          ('filtered-run', 'incomplete', 'content_filter', null),
          ('canceled-run', 'canceled', null, null),
          ('interrupted-run', 'interrupted', null, null),
          ('refused-run', 'failed', null, null),
          ('failed-run', 'failed', null, 'server_error'),
          ('refusal-delta-run', 'completed', null, null),
          ('refusal-output-run', 'completed', null, null),
          ('event-failed-run', 'failed', null, null);

        INSERT INTO usage_logs VALUES
          ('completed', 'completed-run', 1, null, 1),
          ('incomplete', 'incomplete-run', 1, null, 2),
          ('filtered-response', 'filtered-run', 1, null, 3),
          ('canceled', 'canceled-run', 1, null, 4),
          ('interrupted', 'interrupted-run', 1, null, 5),
          ('refused', 'refused-run', 0, 'refusal', 6),
          ('failed', 'failed-run', 0, 'api_error', 7),
          ('filtered-title', null, 0, 'content_filter', 8),
          ('orphan-completed', null, 1, null, 9),
          ('refusal-delta', 'refusal-delta-run', 1, null, 10),
          ('refusal-output', 'refusal-output-run', 1, null, 11),
          ('event-failed', 'event-failed-run', 0, 'api_error', 12);

        INSERT INTO run_events VALUES
          ('refusal-delta-run', 0, 'response.refusal.delta', '{"delta":"cannot comply"}'),
          ('refusal-output-run', 0, 'response.completed', '{"response":{"status":"completed","output":[{"type":"message","content":[{"type":"refusal","refusal":"cannot comply"}]}]}}'),
          ('event-failed-run', 0, 'response.failed', '{"response":{"status":"failed","error":{"code":"model_error","message":"failed"}}}');
      `)

      const migrationSql = readFileSync(migrationPath, 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      )
      sqlite.exec(migrationSql)

      const rows = sqlite
        .prepare(
          'SELECT id, outcome, terminal_reason AS terminalReason FROM usage_logs WHERE created_at <= 9 ORDER BY created_at',
        )
        .all()
      expect(rows).toEqual([
        { id: 'completed', outcome: 'completed', terminalReason: null },
        { id: 'incomplete', outcome: 'incomplete', terminalReason: 'max_output_tokens' },
        { id: 'filtered-response', outcome: 'failed', terminalReason: 'content_filter' },
        { id: 'canceled', outcome: 'canceled', terminalReason: 'user_cancelled' },
        { id: 'interrupted', outcome: 'interrupted', terminalReason: 'server_restart' },
        { id: 'refused', outcome: 'failed', terminalReason: 'refusal' },
        { id: 'failed', outcome: 'failed', terminalReason: 'server_error' },
        { id: 'filtered-title', outcome: 'failed', terminalReason: 'content_filter' },
        { id: 'orphan-completed', outcome: 'completed', terminalReason: null },
      ])

      const responsesRows = sqlite
        .prepare(
          `SELECT id, outcome, terminal_reason AS terminalReason, success, error_type AS errorType
           FROM usage_logs
           WHERE created_at >= 10 OR id = 'filtered-response'
           ORDER BY created_at`,
        )
        .all()
      expect(responsesRows).toEqual([
        {
          id: 'filtered-response',
          outcome: 'failed',
          terminalReason: 'content_filter',
          success: 1,
          errorType: 'content_filter',
        },
        {
          id: 'refusal-delta',
          outcome: 'failed',
          terminalReason: 'refusal',
          success: 1,
          errorType: 'refusal',
        },
        {
          id: 'refusal-output',
          outcome: 'failed',
          terminalReason: 'refusal',
          success: 1,
          errorType: 'refusal',
        },
        {
          id: 'event-failed',
          outcome: 'failed',
          terminalReason: 'model_error',
          success: 0,
          errorType: 'model_error',
        },
      ])
    } finally {
      sqlite.close()
    }
  })
})
