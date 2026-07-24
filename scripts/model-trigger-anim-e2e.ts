/**
 * 触发器胶囊宽度过渡回归脚本（对应「切换模型/思考/联网时平滑改变宽度」需求）。
 *
 * 需先 `npm run dev`，再 `npx tsx scripts/model-trigger-anim-e2e.ts`。
 *
 * 逐条守护历史踩坑（尤其是过去只查重叠/箭头、漏检动画中间文字的问题）：
 * 1. 动画确实发生（宽度出现多个中间值，而非瞬间跳变）。
 * 2. 动画全程标签内容不被截断（任何后代 scrollWidth 都不超过 clientWidth——即无省略号）。
 * 3. 下拉箭头全程完整可见、不被裁切，且不越过按钮右缘。
 * 4. 触发器不与发送按钮重叠（桌面端）。
 * 桌面端与移动端触发器共用同一组件，两种视图都要覆盖。
 */
import { chromium, type Browser, type Page } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'
const USER = process.env.SMOKE_USER ?? 'test'
const PASS = process.env.SMOKE_PASS ?? 'testtest'

interface Frame {
  wrapWidth: number
  truncated: boolean
  chevronWidth: number
  chevronRight: number
  buttonRight: number
}

const failures: string[] = []
function check(cond: boolean, label: string) {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`)
  if (!cond) failures.push(label)
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').fill(USER)
  await page.getByPlaceholder('请输入密码').fill(PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByTestId('model-menu-trigger').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(600)
}

/** 在 `doChange` 触发内容变化的前后，以 ~8ms 间隔采样触发器胶囊的几何状态。 */
async function sampleDuringChange(page: Page, doChange: () => Promise<void>): Promise<Frame[]> {
  await page.evaluate(() => {
    // 注意：不要用 `const fn = () => {}` 这类具名内部函数——tsx/esbuild 会注入
    // `__name` 助手，序列化到浏览器执行时该助手未定义（改用成员赋值的匿名函数表达式）。
    const w = window as unknown as { __frames: Frame[]; __timer: number; __grab: () => void }
    w.__frames = []
    w.__grab = function () {
      const btn = document.querySelector('[data-testid="model-menu-trigger"]')
      const label = document.querySelector('[data-testid="model-trigger-label"]')
      if (!btn || !label) return
      const wrap = label.parentElement as HTMLElement | null
      const chevron = btn.querySelector(':scope > svg')
      const btnRect = btn.getBoundingClientRect()
      const chevRect = chevron ? chevron.getBoundingClientRect() : null
      // 任一后代 scrollWidth 超过 clientWidth => 出现省略号（被截断）。
      let truncated = false
      const nodes = label.querySelectorAll('*')
      for (let i = 0; i < nodes.length; i += 1) {
        if (nodes[i].scrollWidth - nodes[i].clientWidth > 1) {
          truncated = true
          break
        }
      }
      w.__frames.push({
        wrapWidth: wrap ? wrap.getBoundingClientRect().width : 0,
        truncated,
        chevronWidth: chevRect ? chevRect.width : 0,
        chevronRight: chevRect ? chevRect.right : 0,
        buttonRight: btnRect.right,
      })
    }
    w.__grab()
    w.__timer = window.setInterval(w.__grab, 8) as unknown as number
  })
  await doChange()
  await page.waitForTimeout(340)
  return page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[]; __timer: number }
    clearInterval(w.__timer)
    return w.__frames
  })
}

function assertFrames(label: string, frames: Frame[]) {
  console.log(`— ${label}（采样 ${frames.length} 帧）`)
  const distinctWidths = new Set(frames.map((f) => Math.round(f.wrapWidth))).size
  check(distinctWidths >= 3, `宽度平滑过渡（出现 ${distinctWidths} 个不同宽度，非瞬间跳变）`)
  check(
    frames.every((f) => !f.truncated),
    '动画全程标签无省略号（内容始终以最终排版渲染）',
  )
  check(
    frames.every((f) => f.chevronWidth >= 12),
    `下拉箭头全程完整（最小宽 ${Math.min(...frames.map((f) => Math.round(f.chevronWidth)))}px）`,
  )
  check(
    frames.every((f) => f.chevronRight <= f.buttonRight + 1),
    '下拉箭头不越过按钮右缘',
  )
}

async function openMenu(page: Page) {
  const expanded = await page.getByTestId('model-menu-trigger').getAttribute('aria-expanded')
  if (expanded !== 'true') await page.getByTestId('model-menu-trigger').click()
  await page.getByRole('dialog', { name: '模型与参数' }).waitFor({ timeout: 5000 })
}

async function pickModel(page: Page, name: string) {
  await openMenu(page)
  await sampleDuringChange(page, async () => {
    await page.getByRole('dialog', { name: '模型与参数' }).getByText(name, { exact: true }).click()
    await page.waitForTimeout(60)
  }).then((frames) => assertFrames(`切换到 ${name}`, frames))
}

async function toggleWeb(page: Page) {
  await openMenu(page)
  const toggle = page.getByTestId('web-search-toggle')
  if ((await toggle.count()) === 0) {
    console.log('— 跳过联网切换（当前模型不支持联网）')
    return
  }
  await sampleDuringChange(page, async () => {
    await toggle.click()
    await page.waitForTimeout(60)
  }).then((frames) => assertFrames('切换联网（地球增减）', frames))
}

async function runViewport(browser: Browser, label: string, width: number, height: number) {
  console.log(`\n===== ${label}（${width}×${height}）=====`)
  const page = await browser
    .newContext({ viewport: { width, height } })
    .then((c) => c.newPage())
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await login(page)

  // 先落到已知的窄模型作为基线（不采样），确保后续每次「测量切换」都有真实宽度增量，
  // 避免恰好切到与初始模型同宽的模型时被误判为「没有动画」。
  await openMenu(page)
  await page.getByRole('dialog', { name: '模型与参数' }).getByText('GPT-5.4', { exact: true }).click()
  await page.waitForTimeout(320)
  await page.keyboard.press('Escape')

  // 宽 → 窄 → 宽，覆盖扩宽与收窄两个方向。
  await pickModel(page, 'GPT-5.6-Sol')
  await page.keyboard.press('Escape')
  await pickModel(page, 'GPT-5.4')
  await page.keyboard.press('Escape')
  await pickModel(page, 'GPT-5.6-Terra')
  await page.keyboard.press('Escape')

  // 联网地球增减也应带动宽度过渡：切回支持联网的模型再开关两次。
  await pickModel(page, 'GPT-5.6-Sol')
  await page.keyboard.press('Escape')
  await toggleWeb(page)
  await toggleWeb(page)
  await page.keyboard.press('Escape')

  // 桌面端：确认触发器与发送按钮不重叠（移动端触发器在顶栏、无同排发送按钮）。
  if (width >= 768) {
    const overlap = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="model-menu-trigger"]')?.getBoundingClientRect()
      const send =
        document.querySelector('[aria-label="发送"]')?.getBoundingClientRect() ??
        document.querySelector('[data-testid="stop-btn"]')?.getBoundingClientRect()
      if (!btn || !send) return false
      return btn.right > send.left + 1
    })
    check(!overlap, '触发器与发送按钮不重叠')
  }

  check(errors.length === 0, `无 pageerror${errors.length ? '：' + errors.slice(0, 2).join(' / ') : ''}`)
  await page.context().close()
}

async function main() {
  const browser = await chromium.launch()
  await runViewport(browser, '桌面端', 1280, 800)
  await runViewport(browser, '移动端', 390, 800)
  await browser.close()

  console.log('')
  if (failures.length) {
    console.log(`TRIGGER-ANIM FAIL（${failures.length} 项）：`)
    for (const f of failures) console.log('  - ' + f)
    process.exit(2)
  }
  console.log('TRIGGER-ANIM PASS')
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
