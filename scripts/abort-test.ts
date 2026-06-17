const B = process.env.SMOKE_BASE_API ?? 'http://localhost:8787/api'
let cookie = ''

async function j(path: string, init?: RequestInit) {
  const res = await fetch(`${B}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...init?.headers },
  })
  const setC = res.headers.get('set-cookie')
  if (setC) cookie = setC.split(';')[0] ?? cookie
  return res
}

async function main() {
  await j('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const models = (await (await j('/models')).json()) as { models: { id: string; modelId: string }[] }
  const mid = models.models.find((m) => m.modelId === 'gpt-5.4-mini')!.id
  const start = (await (
    await j('/runs', {
      method: 'POST',
      body: JSON.stringify({
        modelId: mid,
        text: 'Write an extremely long 2000-word detailed essay about the entire history of computing.',
      }),
    })
  ).json()) as { runId: string }
  console.log('run:', start.runId)

  await new Promise((r) => setTimeout(r, 400))
  await j(`/runs/${start.runId}`, { method: 'DELETE' })
  console.log('已发送中止请求')

  // 读流，看终止事件
  const res = await j(`/runs/${start.runId}/stream?from=-1`)
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let canceled = false
  let done = false
  let deltas = 0
  for (;;) {
    const { value, done: d } = await reader.read()
    if (d) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        try {
          const o = JSON.parse(line.slice(5).trim()) as { type: string }
          if (o.type === 'run.canceled') canceled = true
          if (o.type === 'run.done') done = true
          if (o.type === 'response.output_text.delta') deltas++
        } catch {
          /* ignore */
        }
      }
    }
  }
  console.log(`deltas=${deltas} sawCanceled=${canceled} sawDone=${done}`)
  console.log(canceled && !done ? 'ABORT PASS' : 'ABORT CHECK (可能在中止前已完成)')
  if (!canceled) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
