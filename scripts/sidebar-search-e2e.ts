import { chromium } from '@playwright/test'
import type { Page } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'
const USER = process.env.SMOKE_USER ?? 'admin'
const PASS = process.env.SMOKE_PASS ?? 'admin123'
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

function conversationIdFromUrl(url: string): string {
  const match = url.match(/\/c\/([^/?#]+)/)
  if (!match?.[1]) throw new Error(`无法从 URL 读取会话 id: ${url}`)
  return match[1]
}

async function pasteBrowserFile(
  page: Page,
  file: { name: string; type: string; text?: string; base64?: string },
) {
  await page.evaluate((payload) => {
    const textarea = document.querySelector('textarea')
    if (!textarea) throw new Error('missing composer textarea')
    const data =
      payload.base64 ?
        Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0))
      : (payload.text ?? '')
    const dt = new DataTransfer()
    dt.items.add(new File([data], payload.name, { type: payload.type }))
    textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, file)
}

async function dropBrowserFile(
  page: Page,
  file: { name: string; type: string; text?: string; base64?: string },
) {
  await page.evaluate((payload) => {
    const data =
      payload.base64 ?
        Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0))
      : (payload.text ?? '')
    const dt = new DataTransfer()
    dt.items.add(new File([data], payload.name, { type: payload.type }))
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
    window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, file)
}

async function waitForPendingAttachment(page: Page, kind: 'file' | 'image') {
  const item = page.locator(`[data-testid="pending-attachment"][data-attachment-kind="${kind}"]`).first()
  await item.waitFor({ timeout: 10_000 })
  await page.getByLabel('移除附件').first().click()
  await item.waitFor({ state: 'detached', timeout: 8_000 })
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newContext().then((context) => context.newPage())
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').fill(USER)
  await page.getByPlaceholder('请输入密码').fill(PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByPlaceholder('发送消息…').waitFor({ timeout: 10_000 })

  const supportsFiles = (await page.getByLabel('上传文件').count()) > 0
  if (supportsFiles) {
    await pasteBrowserFile(page, { name: 'paste-smoke.txt', type: 'text/plain', text: 'paste smoke' })
    await waitForPendingAttachment(page, 'file')
    await dropBrowserFile(page, { name: 'drop-smoke.txt', type: 'text/plain', text: 'drop smoke' })
    await waitForPendingAttachment(page, 'file')
    console.log('✓ 粘贴文件和拖拽文件上传可用')
  }

  const supportsImages = (await page.getByLabel('上传图片').count()) > 0
  if (supportsImages) {
    await pasteBrowserFile(page, { name: 'paste-smoke.png', type: 'image/png', base64: ONE_PIXEL_PNG })
    await waitForPendingAttachment(page, 'image')
    await dropBrowserFile(page, { name: 'drop-smoke.png', type: 'image/png', base64: ONE_PIXEL_PNG })
    await waitForPendingAttachment(page, 'image')
    console.log('✓ 粘贴图片和拖拽图片上传可用')
  }

  await page.getByText('HappyChat').waitFor({ timeout: 8_000 })
  await page.getByRole('button', { name: '新聊天' }).waitFor({ timeout: 8_000 })
  await page.getByRole('button', { name: '搜索聊天' }).waitFor({ timeout: 8_000 })
  console.log('✓ 展开侧边栏基础元素可见')

  const marker = `sidebar-output-${Date.now()}`
  const composer = page.getByPlaceholder('发送消息…')
  await composer.fill(`请用一句话回复，并包含短语：${marker}`)
  const runStarted = page.waitForResponse(
    (response) => response.url().includes('/api/runs') && response.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await composer.press('Enter')
  await runStarted
  await page.waitForTimeout(500)
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-btn"]'), null, {
    timeout: 90_000,
  })
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('[data-testid="assistant-message"]')).some((element) =>
        element.textContent?.trim(),
      ),
    null,
    { timeout: 90_000 },
  )
  const conversationId = conversationIdFromUrl(page.url())
  console.log('✓ 创建搜索用会话:', conversationId)

  const detail = (await page.evaluate(async (id) => {
    const response = await fetch(`/api/conversations/${id}`, { credentials: 'include' })
    return response.json()
  }, conversationId)) as {
    conversation: { title: string | null }
    messages: { role: string; content: { type: string; text?: string }[] }[]
  }
  const assistantText =
    detail.messages
      .find((message) => message.role === 'assistant')
      ?.content.map((part) => (part.type === 'output_text' ? (part.text ?? '') : ''))
      .join('')
      .trim() ?? ''
  if (!assistantText) throw new Error('助手输出为空，无法验证 output 搜索')
  const assistantQuery = assistantText.slice(0, Math.min(18, assistantText.length))

  await page.getByRole('button', { name: '搜索聊天' }).click()
  await page.getByTestId('search-dialog').waitFor({ timeout: 8_000 })
  await page.getByTestId('search-input').fill(marker)
  await page.getByText(marker, { exact: false }).first().waitFor({ timeout: 10_000 })
  await page
    .getByTestId('search-highlight')
    .filter({ hasText: marker })
    .first()
    .waitFor({ timeout: 8_000 })
  console.log('✓ 搜索命中 input/title 内容')
  await page.getByLabel('关闭').click()

  await page.getByRole('button', { name: '搜索聊天' }).click()
  await page.getByTestId('search-input').fill(assistantQuery)
  await page.getByText(assistantQuery, { exact: false }).first().waitFor({ timeout: 10_000 })
  await page
    .getByTestId('search-highlight')
    .filter({ hasText: assistantQuery })
    .first()
    .waitFor({ timeout: 8_000 })
  await page.screenshot({ path: 'data/sidebar-search-dialog.png', fullPage: true })
  await page.getByLabel('关闭').click()
  console.log('✓ 搜索命中 output 内容')

  await page.evaluate(async (id) => {
    const response = await fetch(`/api/conversations/${id}/pin`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    })
    if (!response.ok) throw new Error(`pin failed: ${response.status}`)
    const data = (await response.json()) as { conversation?: { pinnedAt: number | null } }
    if (!data.conversation?.pinnedAt) throw new Error('pin response missing pinnedAt')
  }, conversationId)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('已置顶').waitFor({ timeout: 8_000 })
  const currentSidebarRow = page
    .locator('aside')
    .locator(`[data-conversation-id="${conversationId}"]`)
  await currentSidebarRow.waitFor({ timeout: 8_000 })
  const pinnedSectionToggle = page.locator('aside').getByRole('button', { name: '已置顶', exact: true })
  await pinnedSectionToggle.click()
  await currentSidebarRow.waitFor({ state: 'hidden', timeout: 8_000 })
  await pinnedSectionToggle.click()
  await currentSidebarRow.waitFor({ timeout: 8_000 })
  const chatSectionToggle = page.locator('aside').getByRole('button', { name: '聊天', exact: true })
  await chatSectionToggle.click()
  if ((await chatSectionToggle.getAttribute('aria-expanded')) !== 'false') {
    throw new Error('聊天分组未折叠')
  }
  await chatSectionToggle.click()
  if ((await chatSectionToggle.getAttribute('aria-expanded')) !== 'true') {
    throw new Error('聊天分组未展开')
  }
  await page.getByLabel('账号菜单').click()
  await page.getByRole('button', { name: '退出登录' }).waitFor({ timeout: 8_000 })
  await page.getByRole('link', { name: '管理' }).waitFor({ timeout: 8_000 })
  await page.mouse.click(500, 120)
  await page.screenshot({ path: 'data/sidebar-expanded.png', fullPage: true })
  console.log('✓ 已置顶分组显示置顶会话')

  await page.getByTestId('sidebar-toggle').click()
  await page.getByRole('button', { name: '已置顶' }).click()
  await page.getByRole('heading', { name: '已置顶' }).waitFor({ timeout: 8_000 })
  await page.screenshot({ path: 'data/sidebar-pinned-popover.png', fullPage: true })
  console.log('✓ 折叠栏已置顶 popover 可用')

  await page.getByRole('button', { name: '最近聊天' }).hover()
  await page.getByText('最近聊天').first().waitFor({ timeout: 8_000 })
  await page.getByRole('button', { name: '最近聊天' }).click()
  await page.getByRole('heading', { name: '最近聊天' }).waitFor({ timeout: 8_000 })
  await page.screenshot({ path: 'data/sidebar-recent-popover.png', fullPage: true })
  console.log('✓ 折叠栏 tooltip 和最近聊天 popover 可用')

  await page.getByRole('button', { name: '新聊天' }).click()
  await page.waitForURL(`${BASE}/`, { timeout: 8_000 })
  console.log('✓ 折叠栏新聊天导航可用')

  await page.getByTestId('sidebar-toggle').click()
  for (let i = 0; i < 3; i += 1) {
    if (await page.evaluate(() => document.documentElement.classList.contains('dark'))) break
    await page.getByLabel('切换主题').click()
    await page.waitForTimeout(200)
  }
  if (!(await page.evaluate(() => document.documentElement.classList.contains('dark')))) {
    throw new Error('未能切换到深色模式')
  }
  await page.getByRole('button', { name: '搜索聊天' }).click()
  await page.getByTestId('search-dialog').waitFor({ timeout: 8_000 })
  await page.screenshot({ path: 'data/sidebar-dark-search.png', fullPage: true })
  console.log('✓ 深色模式搜索弹窗截图完成')

  if (errors.length) console.log('⚠ 控制台错误:', errors.slice(0, 5))
  await browser.close()
  console.log('SIDEBAR SEARCH PASS')
}

main().catch((error) => {
  console.error('SIDEBAR SEARCH FAIL:', error instanceof Error ? error.message : error)
  process.exit(1)
})
