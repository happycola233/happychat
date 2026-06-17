import { chromium, type Page } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'

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

  await selectModel(page, 'gpt-image-2')
  const hasImageCtrl = (await page.getByText('自动尺寸').count()) > 0
  console.log('图片尺寸控件可见:', hasImageCtrl)

  await composer.fill('画一个白色背景上的简单红色圆形。')
  await composer.press('Enter')

  // 生成开始（停止按钮出现）
  await page.getByTestId('stop-btn').waitFor({ timeout: 30_000 })
  console.log('✓ 生成开始')
  await page.waitForTimeout(2500)

  // 生成中刷新
  await page.reload({ waitUntil: 'networkidle' })
  console.log('✓ 生成中已刷新，URL:', page.url())

  // 等待图片出现（续传后完成）
  const genImg = page.getByTestId('assistant-message').locator('img[src*="/api/attachments/"]').first()
  await genImg.waitFor({ timeout: 120_000 })
  await page.waitForTimeout(1500)
  const loaded = await genImg.evaluate(
    (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
  )
  console.log('图片已渲染且加载成功:', loaded)

  await page.screenshot({ path: 'data/ui-image-gen.png', fullPage: true })

  if (errors.length) console.log('⚠ pageerror:', errors.slice(0, 3))
  const pass = hasImageCtrl && loaded && errors.length === 0
  console.log(pass ? 'IMAGE-GEN PASS' : 'IMAGE-GEN CHECK')
  await browser.close()
  if (!pass) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
