import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { UserAnnouncementDTO } from '@shared/types/api'

vi.mock('../components/ui/Modal', () => ({
  Modal: ({
    title,
    children,
    footer,
    dismissible,
  }: {
    title: ReactNode
    children: ReactNode
    footer?: ReactNode
    dismissible?: boolean
  }) => (
    <section data-dismissible={String(dismissible)}>
      <header>{title}</header>
      <main>{children}</main>
      {footer && <footer>{footer}</footer>}
    </section>
  ),
}))

vi.mock('../chat/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <article>{text}</article>,
}))

import { AnnouncementDialogView } from './AnnouncementDialog'

function announcement(patch: Partial<UserAnnouncementDTO> = {}): UserAnnouncementDTO {
  return {
    id: 'announcement-1',
    title: '必须确认的公告',
    body: '公告正文',
    level: 'warning',
    channel: 'modal',
    pinned: false,
    publishAt: null,
    createdAt: 0,
    read: false,
    ...patch,
  }
}

describe('AnnouncementDialogView', () => {
  it('keeps an automatic modal non-dismissible until its explicit acknowledgement', () => {
    const html = renderToStaticMarkup(
      <AnnouncementDialogView
        current={announcement()}
        requiresAcknowledgement
        acknowledging={false}
        onAcknowledge={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(html).toContain('data-dismissible="false"')
    expect(html).toContain('我知道了')
    expect(html).toContain('必须确认的公告')
  })

  it('lets readers close an already acknowledged announcement without confirming again', () => {
    const html = renderToStaticMarkup(
      <AnnouncementDialogView
        current={announcement({ read: true })}
        requiresAcknowledgement={false}
        acknowledging={false}
        onAcknowledge={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(html).toContain('data-dismissible="true"')
    expect(html).not.toContain('我知道了')
    expect(html).toContain('>关闭</button>')
  })

  it('does not expose browsing controls that could skip a required acknowledgement', () => {
    const html = renderToStaticMarkup(
      <AnnouncementDialogView
        current={announcement()}
        requiresAcknowledgement
        acknowledging={false}
        pendingCount={3}
        onAcknowledge={vi.fn()}
        onClose={vi.fn()}
        navigation={{ index: 1, total: 3, onPrevious: vi.fn(), onNext: vi.fn() }}
      />,
    )

    expect(html).toContain('3 条公告待确认')
    expect(html).not.toContain('下一条公告')
    expect(html).not.toContain('上一条公告')
    expect(html).toContain('data-dismissible="false"')
  })

  it.each([0, 2])('disables navigation at the boundary of the announcement list (%s)', (index) => {
    const html = renderToStaticMarkup(
      <AnnouncementDialogView
        current={announcement({ read: true })}
        requiresAcknowledgement={false}
        acknowledging={false}
        onAcknowledge={vi.fn()}
        onClose={vi.fn()}
        navigation={{ index, total: 3, onPrevious: vi.fn(), onNext: vi.fn() }}
      />,
    )

    const previous = html.match(/<button[^>]*aria-label="上一条公告"[^>]*>/)?.[0]
    const next = html.match(/<button[^>]*aria-label="下一条公告"[^>]*>/)?.[0]
    expect(previous).toBeDefined()
    expect(next).toBeDefined()
    expect(previous?.includes('disabled=""')).toBe(index === 0)
    expect(next?.includes('disabled=""')).toBe(index === 2)
  })
})
