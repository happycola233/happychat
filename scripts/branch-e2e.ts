import { chromium, type Page } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'

async function waitGenDone(page: Page) {
  // 等待本轮 /api/runs 响应后，停止按钮消失（生成结束）
  await page.waitForTimeout(400)
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-btn"]'), null, {
    timeout: 60_000,
  })
  await page.waitForTimeout(400)
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

  // 第 1 轮
  await composer.fill('请只回复四个字：第一分支')
  await composer.press('Enter')
  await waitGenDone(page)
  console.log('✓ 第一轮完成')

  // 编辑用户消息 → 新分支
  await page.getByLabel('编辑').first().click({ force: true })
  const editBox = page.getByTestId('edit-textarea')
  await editBox.waitFor({ timeout: 5000 })
  await editBox.fill('请只回复四个字：第二分支')
  await page.getByTestId('edit-submit').click()
  await waitGenDone(page)
  console.log('✓ 编辑重发完成（应生成新分支）')

  // 应出现分支切换器
  const branchNav = page.getByLabel('上一个分支')
  await branchNav.first().waitFor({ timeout: 5000 })
  const hasNewText = await page.getByText('第二分支').first().isVisible()
  console.log('编辑后可见“第二分支”:', hasNewText)

  // 切回上一分支
  await branchNav.first().click()
  await page.waitForTimeout(800)
  const backToFirst = await page.getByText('第一分支').first().isVisible()
  console.log('切回后可见“第一分支”:', backToFirst)

  await page.screenshot({ path: 'data/ui-branch.png', fullPage: true })

  if (errors.length) console.log('⚠ pageerror:', errors.slice(0, 3))
  const pass = hasNewText && backToFirst && errors.length === 0
  console.log(pass ? 'BRANCH PASS' : 'BRANCH CHECK')
  await browser.close()
  if (!pass) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
