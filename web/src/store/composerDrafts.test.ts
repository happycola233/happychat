// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Storage } from 'happy-dom'
import type { AttachmentDTO } from '@shared/types/api'
import {
  composerDraftKey,
  flushComposerDrafts,
  loadComposerDraft,
  removeUserComposerDrafts,
  restoreFailedComposerDraft,
  setComposerDraftText,
  startComposerDraftPersistence,
  useComposerDrafts,
} from './composerDrafts'

// 当前 Node 自带的实验性 localStorage 全局（未配置存储文件时为 undefined）会遮住 happy-dom 的实现
vi.stubGlobal('localStorage', new Storage())

const HOUR = 60 * 60 * 1000
const report: AttachmentDTO = {
  id: 'report',
  kind: 'file',
  mime: 'application/pdf',
  filename: '报告.pdf',
  byteSize: 1024,
}

const draft = (key: string) => useComposerDrafts.getState().byKey[key]
const stored = (key: string) => {
  const raw = localStorage.getItem(`happychat-draft:${key}`)
  return raw ? JSON.parse(raw) : null
}
const store = (key: string, value: unknown) =>
  localStorage.setItem(`happychat-draft:${key}`, JSON.stringify(value))

afterEach(() => {
  useComposerDrafts.setState({ byKey: {} })
  flushComposerDrafts()
  localStorage.clear()
})

describe('输入框草稿', () => {
  it('按账号与对话分键，新聊天页单独一份', () => {
    expect(composerDraftKey('alice', 'c1')).toBe('alice:c1')
    expect(composerDraftKey('alice', undefined)).toBe('alice:new')
  })

  it('每条草稿单独写入 localStorage，清空后删除', () => {
    setComposerDraftText('alice:c1', '第一段')
    setComposerDraftText('alice:c2', '第二段')
    flushComposerDrafts()
    expect(stored('alice:c1')).toMatchObject({ text: '第一段', attachments: [] })
    expect(stored('alice:c2')).toMatchObject({ text: '第二段' })

    setComposerDraftText('alice:c1', '')
    flushComposerDrafts()
    expect(stored('alice:c1')).toBeNull()
    expect(draft('alice:c1')).toBeUndefined()
  })

  it('进入草稿时读取其他标签页写入的最新内容，本页未写出的修改优先', () => {
    store('alice:c1', { text: '另一个标签页', attachments: [], updatedAt: Date.now() })
    loadComposerDraft('alice:c1')
    expect(draft('alice:c1')?.text).toBe('另一个标签页')

    setComposerDraftText('alice:c1', '本页刚输入')
    store('alice:c1', { text: '更早的内容', attachments: [], updatedAt: Date.now() })
    loadComposerDraft('alice:c1')
    expect(draft('alice:c1')?.text).toBe('本页刚输入')
  })

  it('超过保留期的附件不再恢复，正文照常恢复', () => {
    store('alice:c1', {
      text: '带附件的草稿',
      attachments: [
        { attachment: report, savedAt: Date.now() - 21 * HOUR },
        { attachment: { ...report, id: 'fresh' }, savedAt: Date.now() - HOUR },
      ],
      updatedAt: Date.now(),
    })
    loadComposerDraft('alice:c1')
    expect(draft('alice:c1')?.text).toBe('带附件的草稿')
    expect(draft('alice:c1')?.uploads.map((item) => item.attachment?.id)).toEqual(['fresh'])
  })

  it('发送失败写回原对话：已有新输入时原文在前', () => {
    setComposerDraftText('alice:c1', '等待时新输入')
    restoreFailedComposerDraft('alice:c1', '发送失败的原文', [report])
    expect(draft('alice:c1')?.text).toBe('发送失败的原文\n\n等待时新输入')
    expect(draft('alice:c1')?.uploads.map((item) => item.attachment?.id)).toEqual(['report'])

    restoreFailedComposerDraft('alice:c2', '切走后才失败', [])
    expect(draft('alice:c2')?.text).toBe('切走后才失败')
  })

  it('退出登录只删除该账号的草稿', () => {
    setComposerDraftText('alice:c1', 'alice 的草稿')
    setComposerDraftText('bob:c1', 'bob 的草稿')
    flushComposerDrafts()

    removeUserComposerDrafts('alice')
    flushComposerDrafts()
    expect(draft('alice:c1')).toBeUndefined()
    expect(stored('alice:c1')).toBeNull()
    expect(draft('bob:c1')?.text).toBe('bob 的草稿')
    expect(stored('bob:c1')).toMatchObject({ text: 'bob 的草稿' })
  })

  it('启动时清理 30 天未改动或损坏的草稿', () => {
    store('alice:old', {
      text: '很久以前',
      attachments: [],
      updatedAt: Date.now() - 31 * 24 * HOUR,
    })
    store('alice:recent', { text: '最近', attachments: [], updatedAt: Date.now() })
    localStorage.setItem('happychat-draft:alice:broken', '{')

    startComposerDraftPersistence()
    expect(stored('alice:old')).toBeNull()
    expect(localStorage.getItem('happychat-draft:alice:broken')).toBeNull()
    expect(stored('alice:recent')).toMatchObject({ text: '最近' })
  })
})
