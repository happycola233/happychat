import { safeHttpUrl } from '@shared/util/url'

/**
 * 消息末尾的引用来源 chip 按产品决定关闭。
 *
 * Citations 组件、annotations 数据链路与导出选项继续保留。
 * 这是代码级显示开关，不对用户设置开放。
 *
 * ⚠ 不要因为接入新协议或「原生搜索引用必须展示」就改回 true。
 * 2026-08-03 的 Anthropic 适配曾因此把开关重新打开。需要恢复时再改这里。
 */
export const SHOW_CITATION_SOURCE_CHIPS = false

/** 上游引用会直接进入可点击链接；只接受浏览器安全的网页协议。 */
export const safeCitationUrl = safeHttpUrl
