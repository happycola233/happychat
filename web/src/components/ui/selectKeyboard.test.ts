import { describe, expect, it } from 'vitest'
import {
  findSelectTypeaheadMatch,
  readSelectTypeaheadKey,
  resolveSelectOpeningHighlight,
} from './selectKeyboard'

describe('Select 键盘定位', () => {
  it('关闭状态输入字符时优先高亮搜索结果，而不是当前选中项', () => {
    expect(resolveSelectOpeningHighlight(3, 2, 1)).toBe(1)
  })

  it('没有有效搜索结果时回退到当前选中项或第一项', () => {
    expect(resolveSelectOpeningHighlight(3, 2, -1)).toBe(2)
    expect(resolveSelectOpeningHighlight(3, -1)).toBe(0)
  })

  it('按不区分大小写的连续前缀匹配选项', () => {
    const options = [{ label: 'Alpha' }, { label: 'Beta' }, { label: 'Bravo' }]

    expect(findSelectTypeaheadMatch(options, 'br')).toBe(2)
    expect(findSelectTypeaheadMatch(options, 'z')).toBe(-1)
  })

  it('中文标签支持全拼和拼音首字母前缀', () => {
    const options = [{ label: '上海' }, { label: '北京' }, { label: '广州' }]

    expect(findSelectTypeaheadMatch(options, 'bei')).toBe(1)
    expect(findSelectTypeaheadMatch(options, 'beijing')).toBe(1)
    expect(findSelectTypeaheadMatch(options, 'BJ')).toBe(1)
    expect(findSelectTypeaheadMatch(options, 'gz')).toBe(2)
  })

  it('拼音只匹配从标签开头连续输入的内容', () => {
    const options = [{ label: '中文拼音' }, { label: '拼音工具' }]

    expect(findSelectTypeaheadMatch(options, 'zhongwenpin')).toBe(0)
    expect(findSelectTypeaheadMatch(options, 'zwp')).toBe(0)
    expect(findSelectTypeaheadMatch(options, 'wen')).toBe(-1)
  })

  it('中文输入法接管 key 时仍能从物理字母键读取拼音', () => {
    const baseEvent = { ctrlKey: false, metaKey: false, altKey: false }

    expect(readSelectTypeaheadKey({ ...baseEvent, key: 'Process', code: 'KeyB' })).toBe('b')
    expect(readSelectTypeaheadKey({ ...baseEvent, key: 'Unidentified', code: 'KeyJ' })).toBe('j')
    expect(readSelectTypeaheadKey({ ...baseEvent, key: 'Process', code: 'Digit1' })).toBeNull()
    expect(
      readSelectTypeaheadKey({ ...baseEvent, ctrlKey: true, key: 'Process', code: 'KeyB' }),
    ).toBeNull()
  })
})
