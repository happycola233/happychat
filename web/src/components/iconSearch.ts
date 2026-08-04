const SEARCH_SEPARATOR_PATTERN = /[\s._/\\-]+/g

/**
 * 内置图标 slug 多数使用英文或品牌拼音。这里维护常用中文品牌名与少数非直译拼音，
 * 让“豆包 / doubao”“千问 / qianwen / qwen”等输入都能落到同一品牌前缀。
 * 前缀而不是完整 slug 用作键，因此 doubao / doubao-color / doubao-text 会共享别名。
 */
const ICON_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  openai: ['chatgpt'],
  claude: ['克劳德'],
  deepseek: ['深度求索', '深寻'],
  doubao: ['豆包'],
  hunyuan: ['腾讯混元', '混元'],
  qwen: ['通义千问', '千问', '通义', 'qianwen', 'tongyi'],
  kimi: ['月之暗面', 'moonshot'],
  zhipu: ['智谱', '智谱清言', '清言', 'chatglm'],
  minimax: ['海螺', 'hailuo'],
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

function compactSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(SEARCH_SEPARATOR_PATTERN, '')
}

/** 空格、连字符和斜杠不影响中文名、拼音或英文名匹配。 */
export function buildIconSearchForms(value: string): string[] {
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase()
  if (!normalized) return []

  const compact = compactSearchText(normalized)
  return compact ? [compact] : []
}

const aliasFormsBySlugPrefix = Object.entries(ICON_SEARCH_ALIASES).map(([slugPrefix, aliases]) => ({
  slugPrefix: compactSearchText(slugPrefix),
  aliases: [...new Set(aliases.flatMap(buildIconSearchForms))],
}))

function matchScore(slug: string, queryForms: readonly string[]): number | null {
  const compactSlug = compactSearchText(slug)
  const searchableForms = [
    compactSlug,
    ...aliasFormsBySlugPrefix.flatMap(({ slugPrefix, aliases }) =>
      compactSlug.startsWith(slugPrefix) ? aliases : [],
    ),
  ]
  let best: number | null = null
  for (const query of queryForms) {
    for (const candidate of searchableForms) {
      const score =
        candidate === query
          ? 0
          : candidate.startsWith(query)
            ? 1
            : candidate.includes(query)
              ? 2
              : null
      if (score !== null && (best === null || score < best)) best = score
    }
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
  const queryForms = buildIconSearchForms(query)
  if (queryForms.length === 0) return { slugs: [], total: 0 }

  const matched = slugs
    .map((slug) => ({ slug, score: matchScore(slug, queryForms) }))
    .filter((item): item is { slug: string; score: number } => item.score !== null)
    .sort((left, right) => left.score - right.score || left.slug.localeCompare(right.slug))

  return {
    slugs: matched.slice(0, limit).map((item) => item.slug),
    total: matched.length,
  }
}
