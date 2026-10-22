import { chromium, type Frame, type Locator, type Page } from '@playwright/test'
import { ARTIFACT_MAX_FRAME_HEIGHT, buildArtifactDocument } from '../shared/util/artifactDocument'

/**
 * Artifacts 端到端冒烟：先 `npm run dev`，再 `npx tsx scripts/artifact-e2e.ts`。
 * SMOKE_MODEL_ID 可指定模型配置 id（需对测试账号开放且开启了 Artifacts 能力）。
 * 截图写入 `.tmp/artifact-e2e-*.png`，供人工检查浅色、深色、手机宽度与生成中状态。
 * `--sizing-only` 只跑确定性的尺寸回归，无需服务、登录或 LLM；`--headed` 使用可见浏览器。
 */
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'
const USERNAME = process.env.SMOKE_USER ?? 'test'
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'testtest'
const MODEL_ID = process.env.SMOKE_MODEL_ID
const ANSWER_TIMEOUT_MS = 240_000
const VERBATIM_PREFIX = '请严格原样输出下面的内容，不要任何额外解释，不要改动其中任何字符：\n\n'

// 自检代码：借 Chart.js 的 CDN 写法验证库内联，并在沙箱内逐项探测隔离边界。
// 使用了主题变量，切换深色时应跟随主题，而不是保持白底。
const PROBE_ARTIFACT = [
  '```artifact',
  '<title>沙箱自检</title>',
  '<div style="height:180px;color:var(--hc-fg)"><canvas id="probe-chart"></canvas></div>',
  '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"></script>',
  '<script>',
  'const r = { chart: typeof Chart, origin: self.origin }',
  'try { r.parent = typeof parent.document } catch (e) { r.parent = "blocked" }',
  'try { r.cookie = document.cookie } catch (e) { r.cookie = "blocked" }',
  'try { localStorage.getItem("x"); r.storage = "open" } catch (e) { r.storage = "blocked" }',
  'try { top.location.href = "about:blank"; r.top = "open" } catch (e) { r.top = "blocked" }',
  'new Chart(document.getElementById("probe-chart"), { type: "line", options: { maintainAspectRatio: false }, data: { labels: [1, 2, 3], datasets: [{ label: "y", data: [1, 4, 9] }] } })',
  'fetch("/api/health").then(() => { r.fetch = "open" }, () => { r.fetch = "blocked" }).finally(() => { document.body.dataset.probe = JSON.stringify(r) })',
  '</script>',
  '```',
].join('\n')

// 写死颜色、不用主题变量的 svg 代码块：按图片处理，深色模式下仍垫白底。
const PROBE_SVG = [
  '```svg',
  '<svg viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg"><title>白底自检</title><path d="M0 30 L40 10 L80 30 L120 10" fill="none" stroke="#1f2937" stroke-width="2"/></svg>',
  '```',
].join('\n')

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
  console.log(`✓ ${message}`)
}

async function waitForAnswer(page: Page): Promise<void> {
  // 发送后先出现停止按钮，回答结束后恢复发送按钮。
  await page
    .getByRole('button', { name: '停止生成' })
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  await page.getByRole('button', { name: '停止生成' }).waitFor({
    state: 'detached',
    timeout: ANSWER_TIMEOUT_MS,
  })
}

async function submit(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder('发送消息…')
  await composer.fill(text)
  await composer.press('Enter')
}

async function send(page: Page, text: string): Promise<void> {
  await submit(page, text)
  await waitForAnswer(page)
}

/** 自然提问：生成过程中确认卡片显示行数并滚动输出最近几行代码（回答太快时可能来不及捕捉）。 */
async function sendWatchingProgress(page: Page, text: string, screenshot: string): Promise<void> {
  await submit(page, text)
  const progress = page.getByText(/正在生成 · \d+ 行/).first()
  const seen = await Promise.race([
    progress.waitFor({ timeout: ANSWER_TIMEOUT_MS }).then(
      () => true,
      () => false,
    ),
    waitForAnswer(page).then(() => false),
  ])
  if (seen) {
    const recent = await page.locator('.hc-artifact-stream').first().innerText()
    check(recent.trim(), `生成中滚动输出最近几行代码（${await progress.textContent()}）`)
    await page.getByTestId('artifact-block').last().screenshot({ path: screenshot })
  } else {
    console.log('⚠ 回答太快，没有捕捉到生成中状态')
  }
  await waitForAnswer(page)
}

async function frameOf(card: Locator): Promise<Frame> {
  const handle = await card.locator('iframe').elementHandle({ timeout: 60_000 })
  const frame = await handle!.contentFrame()
  if (!frame) throw new Error('Artifact iframe 没有可访问的文档')
  return frame
}

async function colorSchemeOf(card: Locator): Promise<string> {
  const frame = await frameOf(card)
  return frame.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
}

async function setDark(page: Page, dark: boolean): Promise<void> {
  await page.evaluate((value) => document.documentElement.classList.toggle('dark', value), dark)
  // 主题切换会重建沙箱文档，等新文档载入并上报尺寸。
  await page.waitForTimeout(1500)
}

/** 检查模型主动输出的 Artifact：已渲染、无运行错误，并截取浅色与深色两张图。 */
async function checkAnswerArtifact(page: Page, name: string): Promise<Locator> {
  const card = page.getByTestId('artifact-block').last()
  check(await card.isVisible(), `${name}：模型按协议输出了 Artifact 卡片`)
  console.log(`${name}标题：`, await card.locator('span.truncate').first().textContent())
  const frame = await frameOf(card)
  await frame.locator('svg, canvas').first().waitFor({ timeout: 30_000 })
  check(true, `${name}：内容已渲染（svg/canvas）`)
  await page.waitForTimeout(2000)
  const errorText = await card.getByText('运行出错').allTextContents()
  check(errorText.length === 0, `${name}：没有运行错误${errorText.length ? `：${errorText}` : ''}`)
  await card.scrollIntoViewIfNeeded()
  await card.screenshot({ path: `.tmp/artifact-e2e-${name}-light.png` })
  await setDark(page, true)
  console.log(`${name}深色模式下的文档配色：`, await colorSchemeOf(card))
  await card.screenshot({ path: `.tmp/artifact-e2e-${name}-dark.png` })
  await setDark(page, false)
  return card
}

async function newChat(page: Page): Promise<void> {
  // 聊天页保持着事件流连接，不会进入 networkidle。
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('发送消息…').waitFor({ timeout: 15_000 })
}

/** 用合成 SVG 覆盖滚动条占宽导致测高偏小的回归，不依赖模型输出或真实聊天内容。 */
async function checkArtifactSizing(page: Page): Promise<void> {
  const source =
    '<svg viewBox="0 0 600 360" style="display:block;width:100%;height:auto"><rect width="600" height="360" fill="var(--hc-surface)"/><path d="M0 359H600" stroke="var(--hc-fg)"/></svg>'
  for (const scheme of ['light', 'dark'] as const) {
    await page.setContent(
      '<!doctype html><iframe title="尺寸自检" sandbox="allow-scripts" style="display:block;border:0;width:768px;height:240px;transition:height .2s ease"></iframe>',
    )
    await page.evaluate(
      ({ doc, maxHeight }) => {
        const iframe = document.querySelector('iframe')!
        window.onmessage = (event) => {
          if (event.source === iframe.contentWindow && event.data.type === 'size') {
            iframe.style.height = `${Math.min(maxHeight, Math.max(48, event.data.height))}px`
          }
        }
        iframe.srcdoc = doc
      },
      {
        doc: buildArtifactDocument({ source, assets: new Map(), theme: { scheme } }),
        maxHeight: ARTIFACT_MAX_FRAME_HEIGHT,
      },
    )
    const frame = (await (await page.locator('iframe').elementHandle())!.contentFrame())!
    await frame.locator('svg').waitFor()
    for (const width of [768, 390, 1024]) {
      await page.locator('iframe').evaluate((el, value) => {
        el.style.width = `${value}px`
      }, width)
      await frame.waitForFunction(() => {
        const root = document.documentElement
        // 除了不可滚动，还必须占满宽度；原问题的空轨道并没有实际可滚动距离。
        return (
          root.scrollHeight === root.clientHeight &&
          Math.abs(innerWidth - root.getBoundingClientRect().width) < 1 &&
          Math.abs(innerHeight - document.body.getBoundingClientRect().height) < 1
        )
      })
      check(true, `${scheme} / ${width}px：SVG 完整展开且没有竖向滚动条占宽`)
    }

    await frame.locator('svg').evaluate((el) => el.setAttribute('viewBox', '0 0 600 1600'))
    await frame.waitForFunction((maxHeight) => {
      const root = document.documentElement
      return (
        innerHeight === maxHeight &&
        root.scrollHeight > root.clientHeight &&
        getComputedStyle(root).overflowY === 'auto'
      )
    }, ARTIFACT_MAX_FRAME_HEIGHT)
    await frame.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    check(
      await frame.evaluate(
        () => scrollY > 0 && document.body.getBoundingClientRect().bottom <= innerHeight + 1,
      ),
      `${scheme}：超过高度上限后可以滚动到底部`,
    )

    await frame.locator('svg').evaluate((el) => el.setAttribute('viewBox', '0 0 600 360'))
    await frame.waitForFunction(
      () =>
        innerHeight < 1000 &&
        document.documentElement.scrollHeight === document.documentElement.clientHeight &&
        Math.abs(innerWidth - document.documentElement.getBoundingClientRect().width) < 1,
    )
    check(true, `${scheme}：长内容收起后恢复完整宽度和自适应高度`)

    await frame.evaluate(() => {
      const wide = document.createElement('div')
      wide.style.cssText = 'width:1600px;height:80px;background:var(--hc-grid)'
      document.body.append(wide)
    })
    await frame.waitForFunction(() => {
      const root = document.documentElement
      return (
        root.scrollWidth > root.clientWidth &&
        root.scrollHeight === root.clientHeight &&
        document.body.getBoundingClientRect().bottom <= root.clientHeight
      )
    })
    await frame.evaluate(() => window.scrollTo(document.documentElement.scrollWidth, 0))
    check(
      await frame.evaluate(() => scrollX > 0),
      `${scheme}：横向溢出仍可滚动，底部内容不被横向滚动条遮挡`,
    )
  }

  await page.setContent(
    buildArtifactDocument({
      source: '<div style="height:1800px;color:var(--hc-fg)">独立网页滚动自检</div>',
      assets: new Map(),
      theme: { scheme: 'light' },
    }),
  )
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  check(
    await page.evaluate(
      () => scrollY > 0 && getComputedStyle(document.documentElement).overflowY !== 'hidden',
    ),
    '下载的独立网页保持正常滚动',
  )
}

async function main() {
  const browser = await chromium.launch({ headless: !process.argv.includes('--headed') })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  if (MODEL_ID) {
    // 初始化脚本也会注入 Artifact 沙箱，只在顶层页面写入偏好。
    await context.addInitScript((modelId) => {
      if (window !== window.top) return
      localStorage.setItem(
        'happychat-prefs',
        JSON.stringify({ state: { pinnedModelId: modelId }, version: 0 }),
      )
    }, MODEL_ID)
  }
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await checkArtifactSizing(page)
  check(pageErrors.length === 0, `尺寸自适应没有浏览器错误：${pageErrors.join('; ')}`)
  if (process.argv.includes('--sizing-only')) {
    await browser.close()
    return
  }

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').fill(USERNAME)
  await page.getByPlaceholder('请输入密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByPlaceholder('发送消息…').waitFor({ timeout: 15_000 })

  // 1. 确定性自检：原样输出一段 Artifact 代码，检查沙箱隔离与库内联。
  await send(page, `${VERBATIM_PREFIX}${PROBE_ARTIFACT}`)
  // Locator 惰性求值：按位置固定取卡片，后续回答出现后仍指向同一张。
  const probeCard = page.getByTestId('artifact-block').first()
  await probeCard.waitFor({ timeout: 30_000 })
  check(
    (await probeCard.locator('iframe').getAttribute('sandbox')) === 'allow-scripts',
    'iframe 只开启 allow-scripts',
  )
  const probeFrame = await frameOf(probeCard)
  const probeJson = await probeFrame
    .locator('body[data-probe]')
    .getAttribute('data-probe', { timeout: 30_000 })
  const probe = JSON.parse(probeJson!) as Record<string, string>
  console.log('沙箱自检结果：', probe)
  check(probe.chart === 'function', 'CDN 写法的 Chart.js 已替换为内联本地副本')
  check(probe.origin === 'null', '沙箱文档为不透明源')
  check(probe.parent === 'blocked', '读取父页面 DOM 被拒绝')
  check(probe.cookie === 'blocked', '读取 cookie 被拒绝')
  check(probe.storage === 'blocked', '访问 localStorage 被拒绝')
  check(probe.top === 'blocked', '导航顶层页面被拒绝')
  check(probe.fetch === 'blocked', '网络请求被 CSP 拦截')
  const height = await probeCard.locator('iframe').evaluate((frame) => frame.clientHeight)
  check(height > 150 && height < 400, `iframe 高度随内容自适应（${height}px）`)

  // 被 CSP 拦下的请求会作为错误上报，并可一键把修复请求填进输入框。
  const errorBar = probeCard.getByText(/运行出错：已阻止访问外部资源/)
  await errorBar.waitFor({ timeout: 10_000 })
  check(true, '被拦截的外部访问显示在 Artifact 卡片上')
  await probeCard.getByRole('button', { name: '让模型修复' }).click()
  const composer = page.getByPlaceholder('发送消息…')
  await page.waitForTimeout(500)
  check(
    (await composer.inputValue()).startsWith('「沙箱自检」运行时出错：'),
    '「让模型修复」把错误说明填进了输入框',
  )
  await composer.fill('')

  // 2. svg 代码块同样渲染为 Artifact 卡片。
  await send(page, `${VERBATIM_PREFIX}${PROBE_SVG}`)
  const svgCard = page.getByTestId('artifact-block').nth(1)
  check(
    (await svgCard.locator('span.truncate').first().textContent()) === '白底自检',
    'svg 代码块渲染为 Artifact 卡片',
  )
  await (await frameOf(svgCard)).locator('svg').waitFor({ timeout: 30_000 })

  // 3. 切换深色：用了主题变量的文档跟随深色，写死颜色的 svg 保持白底。
  await setDark(page, true)
  check((await colorSchemeOf(probeCard)) === 'dark', '切换深色后使用主题变量的文档同步为 dark')
  const svgFrame = await frameOf(svgCard)
  const svgBackground = await svgFrame.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor,
  )
  check(
    (await colorSchemeOf(svgCard)) === 'light' && svgBackground === 'rgb(255, 255, 255)',
    '未使用主题变量的 svg 在深色模式下保持白底',
  )
  await page.screenshot({ path: '.tmp/artifact-e2e-probes-dark.png' })
  await setDark(page, false)

  // 4. 自然提问：模型按协议主动输出 Artifact。
  await newChat(page)
  await sendWatchingProgress(
    page,
    '画出函数 y = sin x 与 y = cos x 在 [-2π, 2π] 上的图像，并标出两者的交点。',
    '.tmp/artifact-e2e-function-generating.png',
  )
  await checkAnswerArtifact(page, 'function')

  await newChat(page)
  await sendWatchingProgress(
    page,
    '讲讲门控 SR 锁存器的工作过程，画出 E、S、R、Q、Q̄ 的时序波形图。',
    '.tmp/artifact-e2e-waveform-generating.png',
  )
  const waveformCard = await checkAnswerArtifact(page, 'waveform')

  // 5. 放大查看：保持聊天里的排版等比放大，整体落在窗口内（1920×1080 即 4K 屏 200% 缩放）。
  await page.setViewportSize({ width: 1920, height: 1080 })
  await waveformCard.getByRole('button', { name: '放大查看' }).click()
  const dialog = page.getByRole('dialog')
  const zoomFrame = dialog.locator('iframe')
  await zoomFrame.waitFor()
  await page.waitForTimeout(1500)
  const scale = await zoomFrame.evaluate(
    (frame) => new DOMMatrixReadOnly(getComputedStyle(frame).transform).a,
  )
  const box = (await dialog.boundingBox())!
  check(
    scale > 1 && box.width <= 1920 * 0.9 + 1 && box.height <= 1080 * 0.9 + 1,
    `放大查看等比放大 ${scale.toFixed(2)} 倍，完整落在窗口内（${Math.round(box.width)}×${Math.round(box.height)}）`,
  )
  const zoomDocument = await (await zoomFrame.elementHandle())!.contentFrame()
  const pixelRatio = await zoomDocument!.evaluate(() => devicePixelRatio)
  check(Math.abs(pixelRatio - scale) < 0.05, `放大后按 ${pixelRatio.toFixed(2)} 倍像素比绘制`)
  await page.screenshot({ path: '.tmp/artifact-e2e-waveform-zoom.png' })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1280, height: 900 })

  // 6. HTML 导出：Artifact 以沙箱 iframe 内联。
  const conversationUrl = page.url()
  const conversationId = new URL(conversationUrl).pathname.split('/').pop()!
  const exported = await page.request.post(`${BASE}/api/conversations/${conversationId}/export`, {
    data: { format: 'html' },
  })
  const html = await exported.text()
  check(
    exported.ok() && /<iframe[^>]*sandbox="allow-scripts"/.test(html),
    'HTML 导出包含沙箱 Artifact',
  )

  // 7. 手机宽度：重新打开会话，Artifact 自适应窄屏且没有横向溢出。
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(conversationUrl, { waitUntil: 'domcontentloaded' })
  const mobileCard = page.getByTestId('artifact-block').last()
  await mobileCard.waitFor({ timeout: 30_000 })
  await mobileCard.scrollIntoViewIfNeeded()
  const mobileFrame = await frameOf(mobileCard)
  await mobileFrame.locator('svg, canvas').first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1000)
  const overflow = await mobileFrame.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  if (overflow > 1) console.log(`⚠ 手机宽度下 Artifact 横向溢出 ${overflow}px`)
  else check(true, '手机宽度下 Artifact 没有横向溢出')
  await mobileCard.screenshot({ path: '.tmp/artifact-e2e-waveform-mobile.png' })

  check(pageErrors.length === 0, `页面没有未捕获错误${pageErrors.length ? `：${pageErrors}` : ''}`)
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
