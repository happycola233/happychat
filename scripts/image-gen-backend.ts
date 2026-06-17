const B = process.env.SMOKE_BASE_API ?? 'http://localhost:8787/api'
let cookie = ''

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`${B}${path}`, { ...init, headers: { Cookie: cookie, ...init?.headers } })
  const setC = res.headers.get('set-cookie')
  if (setC) cookie = setC.split(';')[0] ?? cookie
  return res
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
  const m = models.models.find((x) => x.modelId === 'gpt-image-2')
  console.log('gpt-image-2:', m?.id, 'kind=', m?.kind)
  if (!m) throw new Error('no image model')

  const start = (await (
    await req('/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: m.id,
        text: '画一个白色背景上的简单红色圆形。',
        params: { image: { size: 'auto', quality: 'auto' } },
      }),
    })
  ).json()) as { runId?: string; error?: { message: string } }
  if (!start.runId) throw new Error('start failed: ' + JSON.stringify(start))
  console.log('run:', start.runId)

  const res = await req(`/runs/${start.runId}/stream?from=-1`)
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const types: Record<string, number> = {}
  let err = ''
  let attId = ''
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
          if (o.type === 'image.generation.completed') attId = String(o.data.attachmentId ?? '')
          if (o.type === 'run.error') err = String(o.data.message ?? '')
        } catch {
          /* ignore */
        }
      }
    }
  }
  console.log('事件:', JSON.stringify(types))
  console.log('attachmentId:', attId || '(none)')
  if (err) console.log('错误:', err)
  if (attId) {
    const img = await req(`/attachments/${attId}`)
    console.log('附件 HTTP:', img.status, 'Content-Type:', img.headers.get('content-type'))
  }
  console.log(attId && !err ? 'IMG-BACKEND PASS' : 'IMG-BACKEND FAIL')
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
