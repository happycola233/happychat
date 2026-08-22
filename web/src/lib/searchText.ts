import { match } from 'pinyin-pro'

const SEARCH_SEPARATOR_PATTERN = /[\s._/\\-]+/g
const PINYIN_QUERY_PATTERN = /^[a-z0-9]+$/i
const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u

export type SearchTextMatchKind = 'exact' | 'prefix' | 'contains'

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(SEARCH_SEPARATOR_PATTERN, '')
}

/** 同时识别原文、连续全拼和拼音首字母，并保留匹配发生在开头还是中间的信息。 */
export function classifySearchTextMatch(
  candidate: string,
  query: string,
): SearchTextMatchKind | null {
  const normalizedCandidate = normalizeSearchText(candidate)
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedCandidate || !normalizedQuery) return null
  if (normalizedCandidate === normalizedQuery) return 'exact'
  if (normalizedCandidate.startsWith(normalizedQuery)) return 'prefix'

  const literalMatch = normalizedCandidate.includes(normalizedQuery) ? 'contains' : null
  if (
    !HAN_CHARACTER_PATTERN.test(normalizedCandidate) ||
    !PINYIN_QUERY_PATTERN.test(normalizedQuery)
  ) {
    return literalMatch
  }

  const matchedIndexes = match(normalizedCandidate, normalizedQuery, {
    continuous: true,
    precision: 'start',
    v: true,
  })
  if (!matchedIndexes) return literalMatch
  return matchedIndexes[0] === 0 ? 'prefix' : 'contains'
}

export function searchTextMatchesPrefix(candidate: string, query: string): boolean {
  const matchKind = classifySearchTextMatch(candidate, query)
  return matchKind === 'exact' || matchKind === 'prefix'
}
