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

  await composer.fill(
    '请用 Markdown 回答（不要任何额外解释）：先一个二级标题，然后一个三行两列的表格，然后一个简单的 Python 打印 hello 的代码块，最后写出块级公式 $$E=mc^2$$。',
  )
  await composer.press('Enter')
  await page.waitForTimeout(500)
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-btn"]'), null, {
    timeout: 90_000,
  })
  await page.waitForTimeout(600)

  const msg = page.getByTestId('assistant-message').last()
  const tables = await msg.locator('table').count()
  const pres = await msg.locator('pre').count()
  const katex = await msg.locator('.katex').count()
  console.log(`表格=${tables} 代码块=${pres} KaTeX 公式=${katex}`)

  await page.screenshot({ path: 'data/ui-markdown.png', fullPage: true })

  if (errors.length) console.log('⚠ pageerror:', errors.slice(0, 3))
  const pass = tables > 0 && pres > 0 && katex > 0 && errors.length === 0
  console.log(pass ? 'MARKDOWN PASS' : 'MARKDOWN CHECK')
  await browser.close()
  if (!pass) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
