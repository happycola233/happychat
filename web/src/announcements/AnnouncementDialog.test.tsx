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

  it('keeps manually opened announcement details dismissible without a confirmation footer', () => {
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
  })
})
