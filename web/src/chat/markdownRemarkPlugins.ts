import type { PluggableList } from 'unified'
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly'
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkFlexibleMarkers from 'remark-flexible-markers'

/** Markdown 渲染与流式分块共用的语法配置：两边必须一致，切出的块边界才与整篇解析相同。 */
export const MARKDOWN_REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  // CommonMark 会把 CJK 句末标点视为 punctuation，导致 `**文字。**文字` 无法闭合。
  // 解析期扩展保留标准 AST，并覆盖同类的强调、粗体与 GFM 删除线；删除线扩展须位于 GFM 之后。
  remarkCjkFriendly,
  remarkCjkFriendlyGfmStrikethrough,
  [remarkFlexibleMarkers, { actionForEmptyContent: 'keep' }],
  [remarkMath, { singleDollarTextMath: false }],
]
