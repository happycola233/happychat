import { chromium } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newContext().then((c) => c.newPage())
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin123')
  await page.getByRole('button', { name: '登录' }).click()

  const composer = page.getByPlaceholder('发送消息…')
  await composer.waitFor({ timeout: 10_000 })
  await page.waitForTimeout(1200)

  await composer.fill('请写一篇大约800字的中文短文，详细介绍海洋的奥秘与海洋生物多样性。')
  await composer.press('Enter')

  // 流式开始（出现停止按钮）
  await page.getByTestId('stop-btn').waitFor({ timeout: 30_000 })
  console.log('✓ 流式开始')
  await page.waitForTimeout(700)
  const streamingAtReload = (await page.getByTestId('stop-btn').count()) > 0
  const partial = (await page.getByTestId('assistant-message').last().innerText()).length
  console.log(`刷新前：streaming=${streamingAtReload} 文本长度=${partial}`)

  // 中途硬刷新
  await page.reload({ waitUntil: 'networkidle' })
  console.log('✓ 已刷新，URL:', page.url())

  // 等待生成完成（停止按钮消失）
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-btn"]'), null, {
    timeout: 90_000,
  })
  await page.waitForTimeout(600)
  const finalText = await page.getByTestId('assistant-message').last().innerText()
  console.log(`刷新后最终文本长度=${finalText.length}`)
  console.log('片段:', finalText.slice(0, 50).replace(/\n/g, ' '))

  await page.screenshot({ path: 'data/ui-stream.png', fullPage: true })

  const urlOk = page.url().includes('/c/')
  const substantial = finalText.length > 200
  if (errors.length) console.log('⚠ pageerror:', errors.slice(0, 3))
  const pass = urlOk && substantial && errors.length === 0
  console.log(pass ? 'STREAM-RESUME PASS' : 'STREAM-RESUME CHECK')
  await browser.close()
  if (!pass) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
