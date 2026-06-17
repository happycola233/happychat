import { chromium, type Page } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'

async function waitGenDone(page: Page, timeout = 120_000) {
  await page.waitForTimeout(500)
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-btn"]'), null, {
    timeout,
  })
  await page.waitForTimeout(500)
}

async function selectModel(page: Page, name: string) {
  await page.locator('header button').first().click()
  await page.getByText(name, { exact: true }).click()
  await page.waitForTimeout(300)
}

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

  // —— 思考：选 gpt-5.5 ——
  await selectModel(page, 'gpt-5.5')
  const hasReasoningCtrl = (await page.getByTitle('思考深度').count()) > 0
  console.log('思考深度控件可见:', hasReasoningCtrl)
  await composer.fill('9.11 和 9.9 哪个更大？请简要思考后给出结论。')
  await composer.press('Enter')
  await waitGenDone(page)
  const reasoningShown =
    (await page.getByText(/已深度思考|正在思考|思考过程/).count()) > 0
  console.log('思考摘要卡片出现:', reasoningShown)

  // —— 联网：切到 gpt-5.4-mini 并开启联网 ——
  await selectModel(page, 'gpt-5.4-mini')
  await page.getByText('联网', { exact: true }).click()
  await page.waitForTimeout(200)
  await composer.fill('请用联网搜索查询 Node.js 官方网站地址，并在回答中给出来源链接。')
  await composer.press('Enter')
  await waitGenDone(page)
  const citationCount = await page
    .getByTestId('assistant-message')
    .last()
    .locator('a[target="_blank"]')
    .count()
  console.log('引用链接数量:', citationCount)

  await page.screenshot({ path: 'data/ui-reasoning-web.png', fullPage: true })

  if (errors.length) console.log('⚠ pageerror:', errors.slice(0, 3))
  const pass = hasReasoningCtrl && reasoningShown && citationCount > 0 && errors.length === 0
  console.log(pass ? 'REASONING-WEB PASS' : 'REASONING-WEB CHECK')
  await browser.close()
  if (!pass) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
