import { safeHttpUrl } from '@shared/util/url'

/** 原生联网搜索的引用必须随模型答案展示；本站统一显示为消息末尾来源标签。 */
export const SHOW_CITATION_SOURCE_CHIPS = true

/** 上游引用会直接进入可点击链接；只接受浏览器安全的网页协议。 */
export const safeCitationUrl = safeHttpUrl
