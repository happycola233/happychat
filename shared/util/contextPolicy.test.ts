import { describe, expect, it } from 'vitest'
import type { ContextPolicy } from '../types/context'
import type { ContentPart } from '../types/domain'
import { contextPolicySchema } from '../schemas/context'
import { DEFAULT_CONTEXT_POLICY, selectContext, type ContextMessage } from './contextPolicy'

const upload = (id: string): ContentPart => ({ type: 'input_image', attachment_id: id })
const generated = (id: string): ContentPart => ({ type: 'image_result', attachment_id: id })
const user = (...content: ContentPart[]): ContextMessage => ({ role: 'user', content })
const assistant = (...content: ContentPart[]): ContextMessage => ({ role: 'assistant', content })
const text = (value: string): ContentPart => ({ type: 'input_text', text: value })
const policy = (overrides: Partial<ContextPolicy>): ContextPolicy => ({
  ...DEFAULT_CONTEXT_POLICY,
  ...overrides,
})
const ids = (messages: ContextMessage[]) =>
  messages.flatMap((message) =>
    message.content.flatMap((part) => ('attachment_id' in part ? [part.attachment_id] : [])),
  )

describe('上下文选择', () => {
  it('按轮保留整组混合附件，纯文字轮次不占上传轮数', () => {
    const path = [
      user(upload('old')),
      assistant(),
      user(upload('a'), upload('b'), upload('c'), {
        type: 'input_file',
        attachment_id: 'd',
        filename: 'notes.txt',
      }),
      assistant(),
      user(text('继续')),
      assistant(),
    ]
    const result = selectContext(path, policy({ uploads: { mode: 'rounds', limit: 1 } }))
    expect(ids(result.messages)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.retained).toEqual({ turns: 3, uploads: 4, generatedImages: 0 })
    expect(path[0]!.content).toEqual([upload('old')])
    expect(result.messages[0]!.content).toEqual([
      { type: 'input_text', text: expect.stringContaining('1 个未随本次请求发送') },
    ])
  })

  it('按个数精确保留最近的附件，不按 ID 扩大到旧引用', () => {
    const result = selectContext(
      [user(upload('same')), assistant(), user(upload('a'), upload('same'), upload('b'))],
      policy({ uploads: { mode: 'items', limit: 2 } }),
    )
    expect(ids(result.messages)).toEqual(['same', 'b'])
  })

  it('本次上传完整保留且不挤占历史配额；重新生成也使用原提问作为本次', () => {
    const path = [
      user(upload('old')),
      assistant(),
      user(upload('a'), upload('b'), upload('c'), upload('d')),
    ]
    const result = selectContext(path, policy({ uploads: { mode: 'items', limit: 1 } }), 2)
    expect(ids(result.messages)).toEqual(['old', 'a', 'b', 'c', 'd'])
    expect(result.retained.uploads).toBe(1)
    expect(ids(selectContext(path, policy({ uploads: { mode: 'none' } }), 2).messages)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  it('重复引用同一附件不会占用多个名额', () => {
    const path = [
      user(upload('older')),
      assistant(),
      user(upload('same')),
      assistant(),
      user(upload('same')),
    ]
    expect(
      ids(selectContext(path, policy({ uploads: { mode: 'items', limit: 2 } })).messages),
    ).toEqual(['older', 'same'])
  })

  it('生成图按轮保留同轮的所有回复图片，上传与生成图互不挤占', () => {
    const path = [
      user(upload('u1')),
      assistant(generated('old')),
      user(upload('u2')),
      assistant(generated('g1')),
      assistant(generated('g2'), generated('g3')),
      user(text('继续')),
      assistant(),
    ]
    const result = selectContext(
      path,
      policy({ uploads: { mode: 'none' }, generatedImages: { mode: 'rounds', limit: 1 } }),
    )
    expect(ids(result.messages)).toEqual(['g1', 'g2', 'g3'])
    expect(result.retained.generatedImages).toBe(3)
  })

  it('先截取完整历史轮次及私有上下文，再裁剪附件；本次提问不占历史轮数', () => {
    const path = [
      user(text('old')),
      { ...assistant(), providerReplayContext: { secret: 'old' } },
      user(upload('recent')),
      assistant(generated('g')),
      user(upload('current')),
    ]
    const result = selectContext(
      path,
      policy({ historyTurns: 1, uploads: { mode: 'all' }, generatedImages: { mode: 'all' } }),
      4,
    )
    expect(result.messages).toEqual(path.slice(2))
    expect(result.total.turns).toBe(2)
    expect(result.retained.turns).toBe(1)
  })

  it('仅本次提问时不回传任何历史或私有上下文', () => {
    const path = [user(upload('old')), assistant(generated('g')), user(upload('current'))]
    expect(selectContext(path, policy({ historyTurns: 0 }), 2).messages).toEqual(path.slice(2))
    expect(selectContext(path, policy({ historyTurns: 0 })).messages).toEqual([])
  })

  it('兼容初始 12 张偏好，也允许超过 12 张和全部携带', () => {
    const path = [
      user(text('生成图片')),
      assistant(...Array.from({ length: 20 }, (_, n) => generated(String(n)))),
    ]
    expect(ids(selectContext(path, DEFAULT_CONTEXT_POLICY).messages)).toHaveLength(12)
    expect(
      ids(selectContext(path, policy({ generatedImages: { mode: 'items', limit: 18 } })).messages),
    ).toHaveLength(18)
    expect(
      ids(selectContext(path, policy({ generatedImages: { mode: 'all' } })).messages),
    ).toHaveLength(20)
  })

  it('纯文字、空分支与超过实际轮次的设置可直接使用', () => {
    expect(selectContext([], DEFAULT_CONTEXT_POLICY).retained).toEqual({
      turns: 0,
      uploads: 0,
      generatedImages: 0,
    })
    const path = [user(text('第一问')), assistant({ type: 'output_text', text: '回答' })]
    expect(selectContext(path, policy({ historyTurns: 100 })).messages).toEqual(path)
  })

  it('边界只接受有效整数，不添加上游数量硬上限', () => {
    expect(
      contextPolicySchema.safeParse(policy({ generatedImages: { mode: 'items', limit: 10000 } }))
        .success,
    ).toBe(true)
    for (const limit of [0, -1, 1.5, Infinity, NaN]) {
      expect(
        contextPolicySchema.safeParse(policy({ uploads: { mode: 'rounds', limit } })).success,
      ).toBe(false)
    }
  })

  it('手动选择优先于规则，可单独恢复旧轮次或其他分支附件', () => {
    const path = [user(upload('old')), assistant(generated('g')), user(text('latest'))]
    const available = [...path, assistant(generated('other-branch'))]
    const result = selectContext(
      path,
      policy({ historyTurns: 0 }),
      2,
      { include: ['old', 'other-branch'], exclude: ['g'] },
      available,
    )
    expect(result.messages).toEqual([path[2]])
    expect(result.extraAttachments).toEqual([upload('old'), generated('other-branch')])
    expect(path[2]!.content).toEqual([text('latest')])
  })

  it('取消自动选中的附件不会补入更旧附件；当前提问的附件始终受保护', () => {
    const path = [
      user(upload('old')),
      assistant(),
      user(upload('recent')),
      assistant(),
      user(upload('current')),
    ]
    const result = selectContext(path, policy({ uploads: { mode: 'items', limit: 1 } }), 4, {
      include: [],
      exclude: ['recent', 'current'],
    })
    expect(ids(result.messages)).toEqual(['current'])
    expect(result.extraAttachments).toEqual([])
  })
})
