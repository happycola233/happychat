// 对真实上游的全模型冒烟（除用户指定排除的 gpt-5.3-codex-spark / codex-auto-review）。
const B = process.env.SMOKE_BASE_API ?? 'http://localhost:8787/api'
const EXCLUDED = ['gpt-5.3-codex-spark', 'codex-auto-review']
let cookie = ''

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`${B}${path}`, { ...init, headers: { Cookie: cookie, ...init?.headers } })
  const setC = res.headers.get('set-cookie')
  if (setC) cookie = setC.split(';')[0] ?? cookie
  return res
}

interface RunOutcome {
  types: Record<string, number>
  text: string
  error: string
}

async function streamRun(modelId: string, text: string, params?: unknown): Promise<RunOutcome> {
  const start = (await (
    await req('/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId, text, params }),
    })
  ).json()) as { runId?: string; error?: { message: string } }
  if (!start.runId) return { types: {}, text: '', error: start.error?.message ?? '发起失败' }

  const res = await req(`/runs/${start.runId}/stream?from=-1`)
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const types: Record<string, number> = {}
  let out = ''
  let error = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        try {
          const o = JSON.parse(line.slice(5).trim()) as { type: string; data: Record<string, unknown> }
          types[o.type] = (types[o.type] ?? 0) + 1
          if (o.type === 'response.output_text.delta') out += String(o.data.delta ?? '')
          if (o.type === 'run.error') error = String(o.data.message ?? '错误')
        } catch {
          /* ignore */
        }
      }
    }
  }
  return { types, text: out, error }
}

async function main() {
  await req('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const models = (await (await req('/models')).json()) as {
    models: { id: string; modelId: string; kind: string }[]
  }
  const byUpstream = new Map(models.models.map((m) => [m.modelId, m]))
  const id = (up: string) => byUpstream.get(up)?.id

  const results: { name: string; pass: boolean; detail: string }[] = []

  for (const up of ['gpt-5.4-mini', 'gpt-5.4']) {
    const mid = id(up)
    if (!mid) {
      results.push({ name: up, pass: false, detail: '模型未启用' })
      continue
    }
    const r = await streamRun(mid, '用一句话介绍你自己。')
    results.push({ name: `${up} 文本流式`, pass: r.text.length > 0 && !r.error, detail: r.error || `${r.text.length} 字` })
  }

  // gpt-5.5 思考
  if (id('gpt-5.5')) {
    const r = await streamRun(id('gpt-5.5')!, '9.11 和 9.9 哪个更大？简要思考。', { reasoning_effort: 'medium' })
    const reasoned = (r.types['response.reasoning_summary_text.delta'] ?? 0) > 0
    results.push({
      name: 'gpt-5.5 思考摘要',
      pass: r.text.length > 0 && reasoned && !r.error,
      detail: r.error || `摘要事件=${r.types['response.reasoning_summary_text.delta'] ?? 0} 正文${r.text.length}字`,
    })
  }

  // 联网搜索
  if (id('gpt-5.4-mini')) {
    const r = await streamRun(id('gpt-5.4-mini')!, '用联网搜索 Node.js 官网地址并给出链接。', { web_search: true })
    const searched =
      (r.types['response.web_search_call.completed'] ?? 0) > 0 ||
      (r.types['response.output_text.annotation.added'] ?? 0) > 0
    results.push({ name: 'web_search 联网', pass: searched && !r.error, detail: r.error || `web事件/引用=${(r.types['response.web_search_call.completed'] ?? 0) + (r.types['response.output_text.annotation.added'] ?? 0)}` })
  }

  // 图片生成
  if (id('gpt-image-2')) {
    const r = await streamRun(id('gpt-image-2')!, '画一个蓝色五角星。')
    const done = (r.types['image.generation.completed'] ?? 0) > 0
    results.push({ name: 'gpt-image-2 生图', pass: done && !r.error, detail: r.error || '已生成' })
  }

  console.log('\n=== 全模型冒烟结果 ===')
  for (const r of results) console.log(`${r.pass ? '✅' : '❌'} ${r.name}  —  ${r.detail}`)
  console.log(`（按要求跳过：${EXCLUDED.join(', ')}）`)
  const allPass = results.every((r) => r.pass)
  console.log(allPass ? '\nFINAL-SMOKE PASS' : '\nFINAL-SMOKE FAIL')
  if (!allPass) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
