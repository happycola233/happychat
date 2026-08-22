import { searchTextMatchesPrefix } from '../../lib/searchText'

interface SelectTypeaheadKeyboardEvent {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

export function readSelectTypeaheadKey(event: SelectTypeaheadKeyboardEvent): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key.length === 1) return event.key
  if (event.key !== 'Process' && event.key !== 'Unidentified') return null

  const physicalLetter = /^Key([A-Z])$/.exec(event.code)?.[1]
  return physicalLetter?.toLocaleLowerCase() ?? null
}

export function resolveSelectOpeningHighlight(
  optionCount: number,
  selectedIndex: number,
  preferredIndex?: number,
): number {
  if (preferredIndex !== undefined && preferredIndex >= 0 && preferredIndex < optionCount) {
    return preferredIndex
  }
  if (selectedIndex >= 0 && selectedIndex < optionCount) return selectedIndex
  return 0
}

export function findSelectTypeaheadMatch(
  options: readonly { label: string }[],
  query: string,
): number {
  return options.findIndex((option) => searchTextMatchesPrefix(option.label, query))
}
