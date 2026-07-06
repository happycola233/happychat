import { chromium } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'
const USERNAME = process.env.SMOKE_USER ?? 'test'
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'testtest'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newContext().then((c) => c.newPage())
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').fill(USERNAME)
  await page.getByPlaceholder('请输入密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  const composer = page.getByPlaceholder('发送消息…')
  await composer.waitFor({ timeout: 10_000 })
  await page.waitForTimeout(1200)

  await composer.fill(
    [
      '请严格原样输出下面的 Markdown 测试内容，不要任何额外解释，不要把整体包进代码块：',
      '',
      '## Markdown 升级验证',
      '##### 五级标题',
      '###### 六级标题',
      '',
      '第一行<br>',
      '第二行',
      '',
      '<strong>粗体</strong> <em>斜体</em> <u>下划线</u>',
      '<span style="color: #409eff; font-size: 20px;">蓝色大号文字</span>',
      'H<sub>2</sub>O x<sup>2</sup> <mark>HTML 高亮</mark> ==标记高亮== 按 <kbd>Ctrl</kbd> + <kbd>C</kbd>',
      '',
      '- 前端',
      '  - HTML',
      '  - CSS',
      '  - JavaScript',
      '    - ES6',
      '    - TypeScript',
      '- 后端',
      '  - Node.js',
      '  - Python',
      '',
      '| 项目 | 内容 |',
      '| --- | --- |',
      '| 表格 | 正常 |',
      '',
      '```python',
      'print("hello")',
      '```',
      '',
      '$$E=mc^2$$',
      '',
      '> [!NOTE]',
      '> 这是一条普通说明。',
      '',
      '> [!TIP]',
      '> 这是一条技巧提示。',
      '',
      '> [!IMPORTANT]',
      '> 这是一条重要信息。',
      '',
      '> [!WARNING]',
      '> 这是一条警告信息。',
      '',
      '> [!CAUTION]',
      '> 这是一条危险提示。',
      '',
      '```mermaid',
      'flowchart TD',
      '    A[开始] --> B{是否登录}',
      '    B -- 是 --> C[进入首页]',
      '    B -- 否 --> D[跳转登录页]',
      '```',
      '',
      '```mermaid',
      'sequenceDiagram',
      '    participant 用户',
      '    participant 前端',
      '    用户->>前端: 点击登录',
      '```',
      '',
      '```mermaid',
      'gantt',
      '    title 项目计划',
      '    dateFormat  YYYY-MM-DD',
      '    section 设计',
      '    原型设计 :a1, 2026-07-01, 3d',
      '```',
      '',
      '```mermaid',
      'pie title 技术栈占比',
      '    "JavaScript" : 40',
      '    "Python" : 30',
      '```',
      '',
      '```mermaid',
      'classDiagram',
      '    class Animal {',
      '      +String name',
      '      +eat()',
      '    }',
      '    class Dog {',
      '      +bark()',
      '    }',
      '    Animal <|-- Dog',
      '```',
    ].join('\n'),
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
  const h5 = await msg.locator('h5').count()
  const h6 = await msg.locator('h6').count()
  const br = await msg.locator('br').count()
  const mark = await msg.locator('mark').count()
  const kbd = await msg.locator('kbd').count()
  const nestedLists = await msg.locator('ul ul').count()
  const mermaid = await msg.locator('.hc-mermaid-block').count()
  const alerts = await msg.locator('.hc-md-alert').count()
  console.log(
    `表格=${tables} 代码块=${pres} KaTeX=${katex} H5=${h5} H6=${h6} br=${br} mark=${mark} kbd=${kbd} 嵌套列表=${nestedLists} Mermaid=${mermaid} Alerts=${alerts}`,
  )

  await page.screenshot({ path: 'data/ui-markdown.png', fullPage: true })

  if (errors.length) console.log('⚠ pageerror:', errors.slice(0, 3))
  const pass =
    tables > 0 &&
    pres > 0 &&
    katex > 0 &&
    h5 > 0 &&
    h6 > 0 &&
    br > 0 &&
    mark > 0 &&
    kbd > 0 &&
    nestedLists > 0 &&
    mermaid >= 5 &&
    alerts >= 5 &&
    errors.length === 0
  console.log(pass ? 'MARKDOWN PASS' : 'MARKDOWN CHECK')
  await browser.close()
  if (!pass) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
