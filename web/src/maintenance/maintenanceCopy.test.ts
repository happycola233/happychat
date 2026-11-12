import { describe, expect, it } from 'vitest'
import type { MaintenanceNotice } from '@shared/schemas/maintenance'
import { formatExpectedEnd, maintenanceLanguages, maintenanceNote } from './maintenanceCopy'

const NOW = new Date(2026, 10, 12, 20, 0).getTime()
const LATER = new Date(2026, 10, 12, 21, 30).getTime()

describe('维护页文案', () => {
  it('中英双语按中文、英文的顺序展示', () => {
    expect(maintenanceLanguages('both')).toEqual(['zh', 'en'])
    expect(maintenanceLanguages('en')).toEqual(['en'])
  })

  it('补充说明按语言取用', () => {
    const notice: MaintenanceNotice = {
      language: 'both',
      noteZh: '正在升级模型线路。',
      noteEn: null,
      expectedEndAt: null,
    }
    expect(maintenanceNote(notice, 'zh')).toBe('正在升级模型线路。')
    expect(maintenanceNote(notice, 'en')).toBeNull()
  })

  it('预计恢复时间按语言格式化', () => {
    expect(formatExpectedEnd(LATER, 'zh', NOW)).toBe('预计 11月12日 21:30 恢复。')
    expect(formatExpectedEnd(LATER, 'en', NOW)).toBe('We expect to be back by Nov 12, 9:30 PM.')
  })

  it('未设置或已经过去的预计恢复时间不展示', () => {
    expect(formatExpectedEnd(null, 'zh', NOW)).toBeNull()
    expect(formatExpectedEnd(NOW, 'zh', NOW)).toBeNull()
    expect(formatExpectedEnd(NOW - 1, 'en', NOW)).toBeNull()
  })
})
