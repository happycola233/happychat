/**
 * 登录 / 注册页回归脚本。
 *
 * 需先 `npm run dev`，再 `npx tsx scripts/auth-ui-e2e.ts`。
 *
 * 覆盖两类东西：
 * 1. **其余 E2E 脚本共用的登录选择器**（`请输入用户名` / `请输入密码` 占位符 +
 *    名为「登录」的按钮）。十来个脚本都靠它们进站，改动登录页时最容易顺手改坏，
 *    这里第一时间拦住。
 * 2. **登录页自身的交互**：客户端校验与首个出错字段获得焦点、密码明文切换、
 *    邀请码归一化为大写、未登录切主题只写本地（不弹「设置同步失败」）、
 *    注册页在公开配置到位前不闪出邀请码字段。
 *
 * 不做视觉断言（颜色/阴影靠人眼与截图评审），只守行为。
 */
import { chromium, type Browser, type Page } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'
const USER = process.env.SMOKE_USER ?? 'test'
const PASS = process.env.SMOKE_PASS ?? 'testtest'

const failures: string[] = []
function check(cond: boolean, label: string) {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`)
  if (!cond) failures.push(label)
}

/** 当前聚焦元素的 placeholder，用来断言「校验失败后光标落在第一个出错字段」。 */
function focusedPlaceholder(page: Page): Promise<string> {
  return page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.placeholder ?? '')
}

async function checkLoginPage(page: Page) {
  console.log('登录页')
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })

  // 客户端校验：空表单不发请求，且光标回到用户名
  let requested = false
  const countLogin = (url: string) => {
    if (url.includes('/api/auth/login')) requested = true
  }
  page.on('request', (r) => countLogin(r.url()))
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForTimeout(300)
  check(!requested, '空表单提交不发起登录请求')
  check(await page.getByText('请输入用户名', { exact: true }).isVisible(), '用户名错误提示可见')
  check((await focusedPlaceholder(page)) === '请输入用户名', '光标落在首个出错字段')

  // 密码长度不足时错误落到密码字段
  await page.getByPlaceholder('请输入用户名').fill(USER)
  await page.getByPlaceholder('请输入密码').fill('123')
  await page.getByRole('button', { name: '登录' }).press('Enter')
  await page.waitForTimeout(300)
  check(await page.getByText('密码至少 6 位').isVisible(), '密码下限错误提示可见')
  check((await focusedPlaceholder(page)) === '请输入密码', '光标落在密码字段')

  // 明文切换
  const passwordInput = page.getByPlaceholder('请输入密码')
  check((await passwordInput.getAttribute('type')) === 'password', '密码默认掩码')
  await page.getByRole('button', { name: '显示密码' }).click()
  check((await passwordInput.getAttribute('type')) === 'text', '点击后明文显示')
  await page.getByRole('button', { name: '隐藏密码' }).click()
  check((await passwordInput.getAttribute('type')) === 'password', '再点回到掩码')

  // 未登录切主题：只写 localStorage，不应出现同步失败提示
  await page.getByRole('radio', { name: '深色' }).click()
  await page.waitForTimeout(400)
  check(
    await page.evaluate(() => document.documentElement.classList.contains('dark')),
    '未登录也能切到深色主题',
  )
  check(
    !(await page.locator('body').innerText()).includes('设置同步失败'),
    '未登录切主题不弹同步失败提示',
  )
  await page.getByRole('radio', { name: '跟随系统' }).click()
  await page.waitForTimeout(200)
}

async function checkRegisterPage(page: Page) {
  console.log('注册页')

  // 注册策略由 /auth/bootstrap 决定显隐，这里用一个可变的假响应模拟各种站点配置。
  // 只挂一次路由、期间只改 policy：若边跑边 unroute，正在 sleep 的处理器醒来时
  // 路由已被接管，会抛 "Route is already handled"。
  let policy = { delayMs: 0, needsBootstrap: false, registrationRequiresInviteCode: true }
  await page.route('**/api/auth/bootstrap', async (route) => {
    const current = policy
    if (current.delayMs) await new Promise((resolve) => setTimeout(resolve, current.delayMs))
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          needsBootstrap: current.needsBootstrap,
          registrationRequiresInviteCode: current.registrationRequiresInviteCode,
        }),
      })
    } catch {
      // 页面在延迟期间已经跳走，这次响应没人要了，忽略即可。
    }
  })

  // 公开配置未返回前不得渲染邀请码字段（开放注册的站点否则会闪一下再消失）
  policy = { ...policy, delayMs: 800 }
  await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入用户名').waitFor({ timeout: 5_000 })
  check(
    (await page.getByPlaceholder('请输入邀请码').count()) === 0,
    '公开配置到位前不渲染邀请码字段',
  )
  check(
    await page.getByRole('button', { name: '注册' }).isVisible(),
    '用户名 / 密码与提交按钮先行可用（不摆空转加载态）',
  )

  // 需要邀请码的站点：字段出现，且输入被归一化为大写、去空格
  policy = { delayMs: 0, needsBootstrap: false, registrationRequiresInviteCode: true }
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
  const invite = page.getByPlaceholder('请输入邀请码')
  await invite.waitFor({ timeout: 5_000 })
  await invite.fill('ab 2c3d4')
  check((await invite.inputValue()) === 'AB2C3D4', '邀请码自动转大写并去空格')

  await page.getByRole('button', { name: '注册' }).click()
  await page.waitForTimeout(300)
  check((await focusedPlaceholder(page)) === '请输入用户名', '注册页同样聚焦首个出错字段')

  // 开放注册的站点：邀请码字段不出现
  policy = { delayMs: 0, needsBootstrap: false, registrationRequiresInviteCode: false }
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').waitFor({ timeout: 5_000 })
  await page.waitForTimeout(300)
  check((await page.getByPlaceholder('请输入邀请码').count()) === 0, '开放注册时无邀请码字段')

  // 首位用户：提示自动成为管理员，且始终免邀请码
  policy = { delayMs: 0, needsBootstrap: true, registrationRequiresInviteCode: true }
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
  check(await page.getByText('自动成为管理员').isVisible(), '首位用户提示可见')
  check(
    (await page.getByPlaceholder('请输入邀请码').count()) === 0,
    '首位用户始终免邀请码（字段不出现）',
  )
  await page.unroute('**/api/auth/bootstrap')
}

/** 真正登录一次：守住其余脚本共用的进站路径。 */
async function checkRealLogin(page: Page) {
  console.log('实际登录')
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').fill(USER)
  await page.getByPlaceholder('请输入密码').fill(PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByPlaceholder('发送消息…').waitFor({ timeout: 10_000 })
  check(true, `以 ${USER} 登录并进入聊天界面`)

  // 已登录访问 /login 应被重定向回聊天。
  // 进了聊天就有常驻连接，这里不能等 networkidle（永远不会 idle），只等 URL 变化。
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  const redirected = await page
    .waitForURL((url) => url.pathname === '/', { timeout: 8_000 })
    .then(() => true)
    .catch(() => false)
  check(redirected, '已登录访问 /login 重定向回聊天')
}

async function main() {
  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const page = await browser
      .newContext({ viewport: { width: 1280, height: 900 } })
      .then((c) => c.newPage())
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message))

    await checkLoginPage(page)
    await checkRegisterPage(page)
    await checkRealLogin(page)

    check(
      pageErrors.length === 0,
      `无未捕获前端异常${pageErrors.length ? `：${pageErrors[0]}` : ''}`,
    )
  } finally {
    await browser?.close()
  }

  if (failures.length) {
    console.error(`\n✗ ${failures.length} 项未通过：\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
  console.log('\n✓ 登录 / 注册页全部检查通过')
}

await main()
