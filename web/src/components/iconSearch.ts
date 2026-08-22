import {
  classifySearchTextMatch,
  normalizeSearchText,
  type SearchTextMatchKind,
} from '../lib/searchText'

/**
 * 内置图标 slug 多数使用英文或品牌拼音。这里只维护中文品牌名与非拼音英文别名，
 * 全拼和首字母统一交给通用搜索匹配器推导。
 * 前缀而不是完整 slug 用作键，因此 doubao / doubao-color / doubao-text 会共享别名。
 */
const ICON_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  openai: ['chatgpt'],
  claude: ['克劳德'],
  deepseek: ['深度求索', '深寻'],
  doubao: ['豆包'],
  hunyuan: ['腾讯混元', '混元'],
  qwen: ['通义千问', '千问', '通义'],
  kimi: ['月之暗面', 'moonshot'],
  zhipu: ['智谱', '智谱清言', '清言', 'chatglm'],
  minimax: ['海螺'],
  wenxin: ['文心一言', '文心', 'ernie'],
  stepfun: ['阶跃星辰', '阶跃'],
  yi: ['零一万物', '零一'],
  baichuan: ['百川智能', '百川'],
  sensenova: ['商汤', '日日新', 'sensechat'],
  spark: ['讯飞星火', '星火', '科大讯飞'],
  internlm: ['书生浦语', '浦语'],
  ai360: ['360智脑', '智脑'],
  skywork: ['天工', '昆仑万维'],
  xuanyuan: ['轩辕'],
  jimeng: ['即梦'],
  kling: ['可灵'],
  bytedance: ['字节跳动'],
  volcengine: ['火山引擎'],
  alibabacloud: ['阿里云'],
  tencent: ['腾讯云'],
  baidu: ['百度智能云', '百度云'],
  siliconcloud: ['硅基流动'],
}

const searchAliasesBySlugPrefix = Object.entries(ICON_SEARCH_ALIASES).map(
  ([slugPrefix, aliases]) => ({
    slugPrefix: normalizeSearchText(slugPrefix),
    aliases: [...new Set(aliases.map(normalizeSearchText).filter(Boolean))],
  }),
)

const MATCH_SCORE: Readonly<Record<SearchTextMatchKind, number>> = {
  exact: 0,
  prefix: 1,
  contains: 2,
}

function matchScore(slug: string, query: string): number | null {
  const compactSlug = normalizeSearchText(slug)
  const searchableForms = [
    compactSlug,
    ...searchAliasesBySlugPrefix.flatMap(({ slugPrefix, aliases }) =>
      compactSlug.startsWith(slugPrefix) ? aliases : [],
    ),
  ]
  let best: number | null = null
  for (const candidate of searchableForms) {
    const matchKind = classifySearchTextMatch(candidate, query)
    if (!matchKind) continue
    const score = MATCH_SCORE[matchKind]
    if (best === null || score < best) best = score
  }
  return best
}

export interface IconSearchResult {
  slugs: string[]
  total: number
}

/** 先按精确 / 前缀 / 包含排序，再以 slug 稳定排序并钳制 SVG 请求数量。 */
export function searchIconSlugs(
  slugs: readonly string[],
  query: string,
  limit: number,
): IconSearchResult {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return { slugs: [], total: 0 }

  const matched = slugs
    .map((slug) => ({ slug, score: matchScore(slug, normalizedQuery) }))
    .filter((item): item is { slug: string; score: number } => item.score !== null)
    .sort((left, right) => left.score - right.score || left.slug.localeCompare(right.slug))

  return {
    slugs: matched.slice(0, limit).map((item) => item.slug),
    total: matched.length,
  }
}
