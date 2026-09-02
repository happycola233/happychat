import type { ProcessStep, SearchAction } from '../types/domain'
import { joinReasoningSummaryParts } from './reasoningSummary'

/** 新旧消息/分享快照都可能具备的过程轨字段。 */
export interface ProcessTrackSource {
  processSteps?: ProcessStep[] | null
  reasoningSummary?: string | null
  searchActions?: SearchAction[] | null
  /** 早期公开分享快照使用的旧字段名。 */
  webSearchActions?: SearchAction[] | null
}

/** 新字段一旦存在（包括空数组）即为权威值；只有 null/缺失时才合成旧列。 */
export function processStepsOf(row: ProcessTrackSource): ProcessStep[] {
  if (Array.isArray(row.processSteps)) return row.processSteps

  const steps: ProcessStep[] = []
  if (row.reasoningSummary) steps.push({ kind: 'reasoning', text: row.reasoningSummary })
  for (const action of row.searchActions ?? row.webSearchActions ?? []) {
    steps.push({ kind: 'search', action })
  }
  return steps
}

export function reasoningTextOf(row: ProcessTrackSource): string | null {
  const text = joinReasoningSummaryParts(
    processStepsOf(row)
      .filter(
        (step): step is Extract<ProcessStep, { kind: 'reasoning' }> => step.kind === 'reasoning',
      )
      .map((step) => step.text),
  )
  return text || null
}

export function searchActionsOf(row: ProcessTrackSource): SearchAction[] {
  return processStepsOf(row)
    .filter((step): step is Extract<ProcessStep, { kind: 'search' }> => step.kind === 'search')
    .map((step) => step.action)
}

export function commentaryTextsOf(row: ProcessTrackSource): string[] {
  return processStepsOf(row)
    .filter(
      (step): step is Extract<ProcessStep, { kind: 'commentary' }> => step.kind === 'commentary',
    )
    .map((step) => step.text)
}
