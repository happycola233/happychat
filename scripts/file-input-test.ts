const B = process.env.SMOKE_BASE_API ?? 'http://localhost:8787/api'
let cookie = ''
const MARKER = 'MAGIC_TOKEN_7392'

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`${B}${path}`, {
    ...init,
    headers: { Cookie: cookie, ...init?.headers },
  })
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
    models: { id: string; modelId: string }[]
  }
  const mid = models.models.find((m) => m.modelId === 'gpt-5.4-mini')!.id

  // 上传文本文件
  const fd = new FormData()
  fd.append(
    'file',
    new Blob([`这是一个测试文件。\n其中包含一个特殊标记：${MARKER}\n请记住它。`], {
      type: 'text/plain',
    }),
    'note.txt',
  )
  const up = (await (await req('/attachments', { method: 'POST', body: fd })).json()) as {
    attachment?: { id: string; kind: string }
    error?: { message: string }
  }
  if (!up.attachment) throw new Error('上传失败: ' + JSON.stringify(up))
  console.log('上传成功:', up.attachment.id, 'kind=', up.attachment.kind)

  const start = (await (
    await req('/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: mid,
        text: '这个附件文件里包含一个特殊标记词，请原样告诉我它是什么。',
        attachments: [{ attachmentId: up.attachment.id, kind: 'file', filename: 'note.txt' }],
      }),
    })
  ).json()) as { runId?: string; error?: { message: string } }
  if (!start.runId) throw new Error('发起失败: ' + JSON.stringify(start))

  // 读流
  const res = await req(`/runs/${start.runId}/stream?from=-1`)
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  let errored = ''
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
          const o = JSON.parse(line.slice(5).trim()) as {
            type: string
            data: Record<string, unknown>
          }
          if (o.type === 'response.output_text.delta') text += String(o.data.delta ?? '')
          if (o.type === 'run.error') errored = String(o.data.message ?? '错误')
        } catch {
          /* ignore */
        }
      }
    }
  }
  console.log('回复片段:', text.slice(0, 80).replace(/\n/g, ' '))
  if (errored) console.log('上游错误:', errored)
  const pass = text.includes(MARKER)
  console.log(pass ? 'FILE-INPUT PASS（模型读到了文件内容）' : 'FILE-INPUT CHECK（未读到标记）')
  if (!pass) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
