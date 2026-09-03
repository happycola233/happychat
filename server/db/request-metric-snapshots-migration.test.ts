import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(
  new URL('./migrations/0040_request_metric_snapshots.sql', import.meta.url),
)

describe('request metric snapshots migration', () => {
  it('backfills metrics while their run and event rows still exist', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec(`
        CREATE TABLE runs (
          id text PRIMARY KEY,
          request_params text,
          started_at integer,
          finished_at integer
        );
        CREATE TABLE run_events (
          run_id text NOT NULL,
          type text NOT NULL,
          created_at integer NOT NULL
        );
        CREATE TABLE usage_logs (
          id text PRIMARY KEY,
          run_id text
        );

        INSERT INTO runs VALUES
          ('complete-run', '{"reasoning_effort":"vendor-max"}', 1000, 6400),
          ('no-output-run', '{"reasoning_effort":""}', 2000, 3000);
        INSERT INTO run_events VALUES
          ('complete-run', 'response.created', 1500),
          ('complete-run', 'response.output_text.delta', 3000),
          ('complete-run', 'response.output_text.delta', 3500);
        INSERT INTO usage_logs VALUES
          ('complete', 'complete-run'),
          ('no-output', 'no-output-run'),
          ('orphan', null);
      `)

      const migrationSql = readFileSync(migrationPath, 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      )
      sqlite.exec(migrationSql)

      const rows = sqlite
        .prepare(
          `SELECT
             id,
             reasoning_effort AS reasoningEffort,
             duration_ms AS durationMs,
             first_token_latency_ms AS firstTokenLatencyMs
           FROM usage_logs
           ORDER BY id`,
        )
        .all()
      expect(rows).toEqual([
        {
          id: 'complete',
          reasoningEffort: 'vendor-max',
          durationMs: 5_400,
          firstTokenLatencyMs: 2_000,
        },
        {
          id: 'no-output',
          reasoningEffort: null,
          durationMs: 1_000,
          firstTokenLatencyMs: null,
        },
        {
          id: 'orphan',
          reasoningEffort: null,
          durationMs: null,
          firstTokenLatencyMs: null,
        },
      ])
    } finally {
      sqlite.close()
    }
  })
})
