// 断线续传后端验证：启动长生成 → 读 1.5s 后断开 → 用游标重连 → 校验连续无缝 + 终止。
const B = process.env.SMOKE_BASE_API ?? 'http://localhost:8787/api'
let cookie = ''

interface WireEvent {
  type: string
  seq: number
  data: Record<string, unknown>
}

async function login(): Promise<void> {
  const res = await fetch(`${B}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  cookie = res.headers.get('set-cookie')?.split(';')[0] ?? ''
  if (!cookie) throw new Error('登录未返回 cookie')
}

async function getModelId(): Promise<string> {
  const res = await fetch(`${B}/models`, { headers: { Cookie: cookie } })
  const j = (await res.json()) as { models: { id: string; modelId: string }[] }
  const m = j.models.find((x) => x.modelId === 'gpt-5.4-mini')
  if (!m) throw new Error('找不到 gpt-5.4-mini')
  return m.id
}

async function startRun(modelId: string): Promise<string> {
  const res = await fetch(`${B}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      modelId,
      text: 'Write a detailed 400-word essay about the history of space exploration.',
    }),
  })
  const j = (await res.json()) as { runId: string }
  return j.runId
}

async function readStream(runId: string, from: number, abortAfterMs?: number): Promise<WireEvent[]> {
  const ac = new AbortController()
  if (abortAfterMs) setTimeout(() => ac.abort(), abortAfterMs)
  const res = await fetch(`${B}/runs/${runId}/stream?from=${from}`, {
    headers: { Cookie: cookie },
    signal: ac.signal,
  })
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const events: WireEvent[] = []
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i)
        buf = buf.slice(i + 2)
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) {
            try {
              events.push(JSON.parse(line.slice(5).trim()) as WireEvent)
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof Error && e.name !== 'AbortError') throw e
  }
  return events
}

async function main(): Promise<void> {
  await login()
  const runId = await startRun(await getModelId())
  console.log('run:', runId)

  const seg1 = await readStream(runId, -1, 1500)
  const maxSeq1 = seg1.reduce((m, e) => Math.max(m, e.seq), -1)
  const done1 = seg1.some((e) => e.type === 'run.done')
  console.log(`seg1: events=${seg1.length} maxSeq=${maxSeq1} done=${done1}`)
  if (done1) {
    console.log('⚠ 运行在 1.5s 内已结束，续传未被真正触发；请用更长的生成重试')
  }

  const seg2 = await readStream(runId, maxSeq1)
  const seqs2 = seg2.map((e) => e.seq)
  const first2 = seqs2[0]
  const contiguous = seqs2.every((v, i) => i === 0 || v === seqs2[i - 1]! + 1)
  const noOverlap = seqs2.every((s) => s > maxSeq1)
  const done2 = seg2.some((e) => e.type === 'run.done')
  console.log(
    `seg2: events=${seg2.length} firstSeq=${first2} (expect ${maxSeq1 + 1}) contiguous=${contiguous} noOverlap=${noOverlap} done=${done2}`,
  )

  const seg3 = await readStream(runId, -1)
  const done3 = seg3.some((e) => e.type === 'run.done')
  const text3 = seg3
    .filter((e) => e.type === 'response.output_text.delta')
    .map((e) => String(e.data.delta ?? ''))
    .join('')
  console.log(`seg3 (from=-1 复读): events=${seg3.length} done=${done3} textLen=${text3.length}`)

  const pass =
    !done1 && first2 === maxSeq1 + 1 && contiguous && noOverlap && done2 && done3 && text3.length > 0
  console.log(pass ? 'RESUME PASS' : 'RESUME CHECK')
  if (!pass) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
