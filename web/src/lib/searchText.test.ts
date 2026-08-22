import { describe, expect, it } from 'vitest'
import { classifySearchTextMatch, normalizeSearchText, searchTextMatchesPrefix } from './searchText'

describe('通用搜索文本匹配', () => {
  it('统一大小写、全角字符和常见分隔符', () => {
    expect(normalizeSearchText(' Ｄｏｕ Bao-Color ')).toBe('doubaocolor')
    expect(normalizeSearchText(' 豆 包 ')).toBe('豆包')
  })

  it('识别中文全拼和拼音首字母', () => {
    expect(classifySearchTextMatch('北京', 'beijing')).toBe('prefix')
    expect(classifySearchTextMatch('北京', 'BJ')).toBe('prefix')
    expect(classifySearchTextMatch('吕布', 'lvbu')).toBe('prefix')
  })

  it('区分开头匹配和中间匹配', () => {
    expect(classifySearchTextMatch('通义千问', 'tongyi')).toBe('prefix')
    expect(classifySearchTextMatch('通义千问', 'qianwen')).toBe('contains')
    expect(searchTextMatchesPrefix('通义千问', 'qianwen')).toBe(false)
  })
})
