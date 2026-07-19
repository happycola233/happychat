import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReasoningCard } from './ReasoningCard'

const ADJACENT_REASONING_HEADINGS = [
  'Analyzing primary requirement',
  'Checking input constraints',
  'Comparing candidate approaches',
  'Selecting implementation strategy',
  'Validating edge case behavior',
  'Reviewing compatibility safeguards',
  'Confirming final output structure',
  'Preparing concise response',
]
  .map((title) => `**${title}**`)
  .join('')

describe('ReasoningCard', () => {
  it('renders reasoning sections with Markdown bodies', () => {
    const html = renderToStaticMarkup(
      <ReasoningCard
        text={'Intro.**Heading**\n\n- item\n\n`code`'}
        status="thinking"
        startedAt={1000}
      />,
    )

    expect(html).toContain('Heading')
    // 思考中摘要体走流式逐段渐入：可见单元被包成 hc-stream-seg，代码子树保持原样
    expect(html).toMatch(/<li><span class="hc-stream-seg">item<\/span><\/li>/)
    expect(html).toContain('<code>code</code>')
    expect(html).not.toContain('Intro.**Heading**')
  })

  it('staggers new section titles per visible unit while thinking', () => {
    const html = renderToStaticMarkup(
      <ReasoningCard text={'**分析 edge cases**'} status="thinking" startedAt={1000} />,
    )

    // CJK 逐字、ASCII 整词，逐单元递增 delay 做从左到右扫入；圆点同步弹现
    expect(html).toMatch(/<span class="hc-stream-seg" style="animation-delay:0ms">分<\/span>/)
    expect(html).toMatch(/<span class="hc-stream-seg" style="animation-delay:24ms">析<\/span>/)
    expect(html).toMatch(/<span class="hc-stream-seg" style="animation-delay:48ms">edge<\/span>/)
    expect(html).toMatch(/<span class="hc-stream-seg" style="animation-delay:72ms">cases<\/span>/)
    expect(html).toContain('hc-reasoning-dot-in')

    const completed = renderToStaticMarkup(
      <ReasoningCard
        text={'**分析 edge cases**'}
        status="completed"
        startedAt={null}
        durationMs={3500}
        defaultExpanded
      />,
    )
    // 完成/持久化态标题为纯文本，不重播扫入
    expect(completed).toContain('分析 edge cases')
    expect(completed).not.toContain('hc-stream-seg')
    expect(completed).not.toContain('hc-reasoning-dot-in')
  })

  it('animates section entrance and body segments only while thinking', () => {
    const thinking = renderToStaticMarkup(
      <ReasoningCard text={'**Heading**\n\nbody'} status="thinking" startedAt={1000} />,
    )
    expect(thinking).toContain('hc-reasoning-step-in')
    expect(thinking).toContain('hc-stream-seg')

    const completed = renderToStaticMarkup(
      <ReasoningCard
        text={'**Heading**\n\nbody'}
        status="completed"
        startedAt={null}
        durationMs={3500}
        defaultExpanded
      />,
    )
    // 完成后小节静态渲染（不重播入场、不再包渐入 span），仅完成页脚保留入场动效
    expect(completed).not.toContain('hc-stream-seg')
    expect(completed.match(/hc-reasoning-step-in/g)).toHaveLength(1)
    expect(completed).toMatch(/hc-reasoning-step-in[^>]*data-testid="reasoning-summary-footer"/)
  })

  it('renders every adjacent OpenAI summary heading as a separate section', () => {
    const html = renderToStaticMarkup(
      <ReasoningCard
        text={ADJACENT_REASONING_HEADINGS}
        status="completed"
        startedAt={null}
        durationMs={32_000}
        defaultExpanded
      />,
    )

    expect(html.match(/hc-reasoning-section/g)).toHaveLength(8)
    expect(html).toContain('Analyzing primary requirement')
    expect(html).toContain('Preparing concise response')
    expect(html).not.toContain('<strong>')
  })

  it('does not render a toggle or body before reasoning text arrives', () => {
    const html = renderToStaticMarkup(<ReasoningCard text="" status="thinking" startedAt={null} />)

    expect(html).toContain('正在思考')
    expect(html).toContain('reasoning-top-status')
    expect(html).not.toContain('折叠推理摘要')
    expect(html).not.toContain('hc-reasoning-section')
    expect(html).not.toContain('rounded-full bg-current')
  })

  it('renders one vertical segment when there is no bold heading', () => {
    const html = renderToStaticMarkup(
      <ReasoningCard text="plain summary" status="completed" startedAt={null} durationMs={3500} />,
    )

    expect(html.match(/hc-reasoning-section/g)).toHaveLength(1)
    expect(html).toContain('grid-cols-[14px_minmax(0,1fr)]')
    expect(html).toContain('plain summary')
  })

  it('only applies shimmer to the top status while thinking', () => {
    const html = renderToStaticMarkup(
      <ReasoningCard text="summary" status="thinking" startedAt={1000} />,
    )

    expect(html.match(/hc-reasoning-shimmer/g)).toHaveLength(1)
    expect(html).toContain('data-testid="reasoning-card"')
    expect(html).toContain('reasoning-top-toggle')
    expect(html).toContain('hc-reasoning-sticky')
    expect(html).toContain('sticky top-0 z-20')
    expect(html).toMatch(/<button[^>]*class="hc-reasoning-status[^"]*"/)
    expect(html).not.toMatch(/<button[^>]*class="[^"]*hc-reasoning-shimmer/)
    expect(html).toMatch(
      /<span class="hc-reasoning-shimmer" data-testid="reasoning-top-label">正在思考/,
    )
  })

  it('allows the sticky status line to sit below a page header', () => {
    const html = renderToStaticMarkup(
      <ReasoningCard
        text="summary"
        status="completed"
        startedAt={null}
        durationMs={3500}
        stickyTopClassName="top-[var(--hc-share-header-height)]"
      />,
    )

    expect(html).toContain('sticky top-[var(--hc-share-header-height)] z-20')
    expect(html).not.toContain('sticky top-0 z-20')
  })

  it('does not render the completed summary footer without a summary', () => {
    const html = renderToStaticMarkup(
      <ReasoningCard text="" status="completed" startedAt={null} durationMs={3500} />,
    )

    expect(html).toContain('已思考 3s')
    expect(html).not.toContain('完成')
    expect(html).not.toContain('折叠推理摘要')
    expect(html).not.toContain('reasoning-completed-icon')
  })

  it('appends a completed footer at the end of existing reasoning summary', () => {
    const html = renderToStaticMarkup(
      <ReasoningCard
        text="summary"
        status="completed"
        startedAt={null}
        durationMs={3500}
        defaultExpanded
      />,
    )

    expect(html).toContain('summary')
    expect(html).toContain('已思考 3s')
    expect(html).toContain('完成')
    expect(html).toContain('reasoning-top-toggle')
    expect(html).toContain('reasoning-summary-footer')
    expect(html).toContain('class="grid grid-cols-[14px_minmax(0,1fr)] gap-x-2')
    expect(html).toContain('hc-reasoning-footer-title')
    expect(html).toContain('hc-reasoning-footer-detail')
    expect(html).toContain('折叠推理摘要')
    expect(html).toContain('reasoning-completed-icon')
    expect(html).toContain('fill="currentColor"')
    expect(html).not.toContain('ml-[22px]')
    expect(html).not.toContain('max-h-64')
    expect(html).not.toContain('overflow-y-auto')
  })

  it('shows stopped reasoning without the completed footer', () => {
    const html = renderToStaticMarkup(
      <ReasoningCard text="" status="stopped" startedAt={null} durationMs={3500} />,
    )

    expect(html).toContain('已停止思考')
    expect(html).not.toContain('完成')
  })
})
