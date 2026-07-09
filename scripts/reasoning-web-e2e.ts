import { chromium, type Page } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'

async function waitGenDone(page: Page, timeout = 120_000) {
  await page.waitForTimeout(500)
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-btn"]'), null, {
    timeout,
  })
  await page.waitForTimeout(500)
}

// 模型/思考/联网已聚合进输入框右侧的 ModelControlMenu（桌面端）。
async function selectModel(page: Page, name: string) {
  await page.getByTestId('model-menu-trigger').click()
  await page.getByText(name, { exact: true }).click()
  // 产品交互里选择后会保持菜单打开；脚本主动收起，后续需要时再展开。
  await page.keyboard.press('Escape')
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

  // —— 思考：选 gpt-5.5，展开聚合菜单确认思考深度分区存在 ——
  await selectModel(page, 'gpt-5.5')
  await page.getByTestId('model-menu-trigger').click()
  const hasReasoningCtrl = (await page.getByText('思考深度', { exact: true }).count()) > 0
  await page.keyboard.press('Escape')
  console.log('思考深度控件可见:', hasReasoningCtrl)
  await composer.fill('9.11 和 9.9 哪个更大？请简要思考后给出结论。')
  await composer.press('Enter')
  await waitGenDone(page)
  const reasoningShown =
    (await page.getByText(/已思考|正在思考|已停止思考/).count()) > 0
  console.log('思考摘要卡片出现:', reasoningShown)

  // —— 联网：切到 gpt-5.4-mini 并在聚合菜单里开启联网 ——
  await selectModel(page, 'gpt-5.4-mini')
  await page.getByTestId('model-menu-trigger').click()
  await page.getByTestId('web-search-toggle').click()
  await page.keyboard.press('Escape')
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
