import { LOBE_ICON_SLUG_PATTERN } from './modelIcon'

/**
 * 按上游模型 ID 自动识别品牌图标。
 *
 * 规则**按顺序**匹配，先具体后宽泛（例如 GPT Image 与 DALL·E 必须先分开识别，
 * 不能因为都能生图就共用 DALL·E 品牌图标）。匹配对象是小写化的 modelId，未命中时再退一步匹配 displayName——
 * 网关常把上游 id 改成 `xxx/claude-sonnet-5` 之类，而管理员填的外显名往往更干净。
 *
 * 取色原则：**有官方彩色版就用彩色版**（品牌辨识度是图标存在的意义），
 * 只有本身就是单色标识的品牌（OpenAI / Grok / Flux 等）才用单色版——
 * 单色版内部是 `currentColor`，前端会用 CSS mask 渲染，深浅色主题都清晰。
 *
 * 这里只做「猜测」：结果既用于未配置图标时的渲染兜底，也用于管理端「批量识别图标」把猜测
 * 固化成显式值。管理员随时可以覆盖，因此宁可漏判（返回 null 用文字首字母兜底），不可错判。
 */
interface IconGuessRule {
  test: RegExp
  slug: string
}

const RULES: readonly IconGuessRule[] = [
  // —— OpenAI 家族（产品专属标识优先于通用品牌）——
  // GPT Image 与 DALL·E 是不同模型家族；图标包暂无 GPT Image 专属标识，因此使用 OpenAI 通用图标。
  { test: /gpt[\s._-]?image/, slug: 'openai' },
  { test: /dall[\s._-]?e/, slug: 'dalle-color' },
  { test: /\bsora\b/, slug: 'sora-color' },
  { test: /\bcodex\b/, slug: 'codex-color' },
  { test: /\bwhisper\b|text-embedding|\btts-|gpt|chatgpt|\bo[1-9](?:-|$)/, slug: 'openai' },

  // —— Anthropic ——
  { test: /claude|anthropic/, slug: 'claude-color' },

  // —— Google ——
  { test: /gemini/, slug: 'gemini-color' },
  { test: /gemma/, slug: 'gemma-color' },
  { test: /imagen|\bveo(?:-|\d|$)/, slug: 'google-color' },
  { test: /palm|bison|gecko/, slug: 'google-color' },

  // —— 国内主流 ——
  { test: /deepseek/, slug: 'deepseek-color' },
  { test: /qwen|qwq|qvq|tongyi/, slug: 'qwen-color' },
  { test: /kimi|moonshot/, slug: 'kimi-color' },
  { test: /\bglm\b|chatglm|zhipu|cogview|cogvideo|cogagent/, slug: 'zhipu-color' },
  { test: /doubao|seedream|seedance|seed-|volcengine/, slug: 'doubao-color' },
  { test: /hunyuan/, slug: 'hunyuan-color' },
  { test: /minimax|abab|hailuo/, slug: 'minimax-color' },
  { test: /ernie|wenxin/, slug: 'wenxin-color' },
  { test: /^yi-|\byi-(?:large|medium|spark|vision)/, slug: 'yi-color' },
  { test: /step-\d|stepfun/, slug: 'stepfun-color' },
  { test: /baichuan/, slug: 'baichuan-color' },
  { test: /sensechat|sensenova/, slug: 'sensenova-color' },
  { test: /spark(?:desk|-)|generalv/, slug: 'spark-color' },
  { test: /internlm|intern-vl|internvl/, slug: 'internlm-color' },
  { test: /360gpt|360zhinao/, slug: 'ai360-color' },
  { test: /xuanyuan/, slug: 'xuanyuan-color' },
  { test: /skywork/, slug: 'skywork-color' },
  { test: /jimeng/, slug: 'jimeng-color' },
  { test: /\bvidu\b/, slug: 'vidu-color' },
  { test: /kling|kolors/, slug: 'kling-color' },
  { test: /pixverse/, slug: 'pixverse-color' },
  { test: /\brwkv\b/, slug: 'rwkv' },

  // —— 海外开源 / 其他厂商 ——
  { test: /\bgrok\b|\bxai\b/, slug: 'grok' },
  { test: /llama|codellama/, slug: 'meta-color' },
  { test: /mistral|mixtral|codestral|magistral|devstral|ministral|pixtral/, slug: 'mistral-color' },
  { test: /\bsonar\b|perplexity/, slug: 'perplexity-color' },
  { test: /command-|command\b|cohere|\baya\b/, slug: 'cohere-color' },
  { test: /\bphi-\d/, slug: 'microsoft-color' },
  { test: /nemotron/, slug: 'nvidia-color' },
  { test: /\bdbrx\b/, slug: 'dbrx-color' },
  { test: /\bjamba\b/, slug: 'ai21' },
  { test: /granite/, slug: 'ibm' },
  { test: /\bnova-(?:pro|lite|micro|premier|canvas|reel|sonic)/, slug: 'nova-color' },
  { test: /\bsolar-/, slug: 'upstage-color' },
  { test: /voyage-/, slug: 'voyage-color' },
  { test: /jina-/, slug: 'jina' },

  // —— 生图 / 音视频 ——
  { test: /\bflux\b/, slug: 'flux' },
  { test: /stable-?diffusion|\bsdxl\b|\bsd[13]\b|stability/, slug: 'stability-color' },
  { test: /midjourney/, slug: 'midjourney' },
  { test: /ideogram/, slug: 'ideogram' },
  { test: /recraft/, slug: 'recraft' },
  { test: /\bsuno\b/, slug: 'suno' },
  { test: /runway|\bgen-[34]\b/, slug: 'runway' },
  { test: /\bpika\b/, slug: 'pika' },
  { test: /\bluma\b|dream-?machine/, slug: 'luma-color' },
  { test: /viggle/, slug: 'viggle' },
]

/** 供单测断言「表里每个 slug 都真实存在于图标包」使用。 */
export const GUESSED_ICON_SLUGS: readonly string[] = [...new Set(RULES.map((rule) => rule.slug))]

function matchSlug(text: string): string | null {
  if (!text) return null
  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.slug
  }
  return null
}

/**
 * 按上游模型 id（必要时回退外显名）猜一个内置图标 slug；认不出来返回 null。
 */
export function guessModelIconSlug(modelId: string, displayName?: string | null): string | null {
  const slug =
    matchSlug(modelId.toLowerCase()) ?? matchSlug((displayName ?? '').toLowerCase()) ?? null
  // 兜底自检：万一表里被写进非法 slug，也不能让它流到 URL 里。
  return slug && LOBE_ICON_SLUG_PATTERN.test(slug) ? slug : null
}
