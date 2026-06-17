import { chromium } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'
const USER = process.env.SMOKE_USER ?? 'admin'
const PASS = process.env.SMOKE_PASS ?? 'admin123'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newContext().then((c) => c.newPage())
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  // 登录
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').fill(USER)
  await page.getByPlaceholder('请输入密码').fill(PASS)
  await page.getByRole('button', { name: '登录' }).click()

  // 进入聊天：等待输入框出现 + 模型加载
  const composer = page.getByPlaceholder('发送消息…')
  await composer.waitFor({ timeout: 10_000 })
  await page.waitForTimeout(1500)
  console.log('✓ 登录并进入聊天界面')

  // 发送消息（流式 /api/runs）
  await composer.fill('请只回复两个字：你好')
  const respPromise = page.waitForResponse(
    (r) => r.url().includes('/api/runs') && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await composer.press('Enter')
  await respPromise
  // 等待流式生成结束（停止按钮消失）
  await page.waitForTimeout(500)
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-btn"]'), null, {
    timeout: 90_000,
  })
  const text = await page.getByTestId('assistant-message').last().innerText()
  console.log('✓ 收到回复 片段=', text.slice(0, 24).replace(/\n/g, ' '))
  if (!text.trim()) throw new Error('助手回复为空')

  await page.waitForTimeout(500)
  console.log('✓ 当前 URL =', page.url())
  await page.screenshot({ path: 'data/ui-chat.png', fullPage: true })

  // 刷新：会话历史应持久化
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('请只回复两个字：你好').first().waitFor({ timeout: 8_000 })
  console.log('✓ 刷新后会话历史仍在')

  if (errors.length) console.log('⚠ 控制台错误:', errors.slice(0, 5))
  else console.log('✓ 无控制台错误')

  await browser.close()
  console.log('SMOKE PASS')
}

main().catch((e) => {
  console.error('SMOKE FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
