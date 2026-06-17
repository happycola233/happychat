import { chromium, type Browser } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'

async function loginAdmin(browser: Browser) {
  const page = await browser.newContext().then((c) => c.newPage())
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin123')
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByPlaceholder('发送消息…').waitFor({ timeout: 10_000 })
  return page
}

async function main() {
  const browser = await chromium.launch()
  const errors: string[] = []
  const admin = await loginAdmin(browser)
  admin.on('pageerror', (e) => errors.push(e.message))

  // 统计页渲染
  await admin.goto(`${BASE}/admin/stats`, { waitUntil: 'networkidle' })
  await admin.getByRole('heading', { name: '统计' }).waitFor({ timeout: 8000 })
  console.log('✓ 统计页渲染')

  // 生成邀请码
  await admin.goto(`${BASE}/admin/invites`, { waitUntil: 'networkidle' })
  await admin.getByRole('button', { name: '生成邀请码' }).click()
  await admin.getByRole('button', { name: '生成', exact: true }).click()
  await admin.waitForTimeout(800)
  const rowText = await admin.locator('tbody tr').first().innerText()
  const code = rowText.match(/[A-Z2-9]{8}/)?.[0] ?? ''
  console.log('✓ 生成邀请码:', code)
  if (!code) throw new Error('未能读取邀请码')

  // 新用户用邀请码注册
  const username = `friend${Date.now().toString().slice(-6)}`
  const reg = await browser.newContext().then((c) => c.newPage())
  await reg.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
  await reg.getByPlaceholder(/3-32 位/).fill(username)
  await reg.getByPlaceholder(/至少 6 位/).fill('friendpw123')
  await reg.getByPlaceholder('请输入邀请码').fill(code)
  await reg.getByRole('button', { name: '注册' }).click()
  await reg.getByPlaceholder('发送消息…').waitFor({ timeout: 10_000 })
  console.log('✓ 新用户用邀请码注册并登录成功:', username)

  // 管理员用户列表应包含新用户
  await admin.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' })
  await admin.waitForTimeout(500)
  const hasUser = (await admin.getByText(username, { exact: false }).count()) > 0
  console.log('✓ 用户列表包含新用户:', hasUser)

  await admin.screenshot({ path: 'data/ui-admin.png', fullPage: true })

  if (errors.length) console.log('⚠ pageerror:', errors.slice(0, 3))
  const pass = !!code && hasUser && errors.length === 0
  console.log(pass ? 'ADMIN PASS' : 'ADMIN CHECK')
  await browser.close()
  if (!pass) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
