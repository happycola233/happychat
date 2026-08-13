// 集中管理的领域类型，前后端共享。JSON 字段类型也在此定义，供 Drizzle schema 复用。

export type UserRole = 'admin' | 'user'
export type Role = 'user' | 'assistant' | 'system'

/** 聊天消息用量行支持的成本展示币种；底层成本始终以 USD 保存。 */
export type CostCurrency = 'USD' | 'CNY'

/** 上游原生协议；决定鉴权头、版本路径与模型目录的解析方式。 */
export type ProviderProtocol = 'openai' | 'anthropic'

// ========================= 站内公告 =========================

/** 公告级别：决定配色与默认触达强度（info 蓝 / success 绿 / warning 琥珀 / critical 红）。 */
export type AnnouncementLevel = 'info' | 'success' | 'warning' | 'critical'

/**
 * 触达渠道（决定用户如何看到公告）：
 * - silent：仅进铃铛通知中心
 * - banner：聊天区顶部可关闭横幅
 * - modal：首次进入自动弹窗，需确认
 */
export type AnnouncementChannel = 'silent' | 'banner' | 'modal'

/** 受众：全体登录用户 / 仅管理员（预留可扩展按角色·按人定向）。 */
export type AnnouncementAudience = 'all' | 'admins'

/** 发布状态：草稿（永不对用户可见）/ 已发布（按生效窗口计算可见性）。 */
export type AnnouncementStatus = 'draft' | 'published'

/**
 * 读取时按 status + 生效窗口派生的运行态（仅用于管理端展示，不落库）：
 * - draft：草稿
 * - scheduled：已发布但 publishAt 未到（定时待发）
 * - active：已发布且处于生效窗口内
 * - expired：已发布但已过 expiresAt
 */
export type AnnouncementPhase = 'draft' | 'scheduled' | 'active' | 'expired'

/**
 * 模型能力标记（管理员配置；前端据此显示/禁用对应控件）。
 *
 * `x_search` 是 xAI Grok 独有的 X（原 Twitter）站内检索工具，与 `web_search` 相互独立，
 * 可同时开启；旧记录没有该字段，读取时按 false 处理。
 */
export interface ModelCapabilities {
  vision: boolean
  file_input: boolean
  web_search: boolean
  x_search: boolean
  image_generation: boolean
  reasoning: boolean
}

/** 用户可见的模型标签；color=null 时按标签文字稳定自动配色。 */
export interface ModelTag {
  label: string
  /** 自定义主题色（#RRGGBB）；null=自动配色。 */
  color: string | null
}

/** models.tags JSON 的兼容存储形态；旧记录是字符串，新记录统一写对象。 */
export type StoredModelTag = string | ModelTag

/**
 * 模型 / 模型分组都能使用的图形资源。三种来源收敛到同一个 JSON 结构：
 * - lobe：自托管的 @lobehub/icons-static-svg 内置库，slug 即文件名（不含 .svg）。
 *   单色图标内部是 fill="currentColor"，前端用 CSS mask 渲染以随主题变色。
 * - custom：管理员上传的自定义图标（model_icons.id）。
 * - emoji：单个字素簇，与聊天文件夹的 Emoji 图标同一套输入规则。
 */
export type ModelIconAsset =
  | { type: 'lobe'; slug: string }
  | { type: 'custom'; id: string }
  | { type: 'emoji'; char: string }

/**
 * 模型图标比模型分组多一个显式的首字母模式。
 *
 * `null` 仍表示自动模式：先按模型 ID / 外显名识别品牌，认不出时才回退首字母；
 * `{type:'initial'}` 则表示管理员明确关闭自动品牌识别，始终使用名称首字母。
 */
export type ModelIcon = ModelIconAsset | { type: 'initial' }

/** models.icon JSON 列的存储形态。 */
export type StoredModelIcon = ModelIcon | null

/**
 * 模型分组图标额外支持显式无图标模式。
 *
 * `null` 保留为默认文件夹图形，以兼容所有既有分组；`{type:'none'}` 才表示标题行
 * 完全不渲染图标，也不保留空白图标槽。模型专用的首字母模式没有分组语义。
 */
export type ModelGroupIcon = ModelIconAsset | { type: 'none' }

/** model_groups.icon JSON 列的存储形态。 */
export type StoredModelGroupIcon = ModelGroupIcon | null

/**
 * 原样发送给上游的 reasoning.effort 值。
 *
 * 不再使用封闭联合类型：不同模型、OpenAI 兼容上游以及未来模型可能提供不同档位，
 * 真正可用的值由每个模型自己的 allowedEfforts 配置门控。
 */
export type ReasoningEffort = string

/** 一个可选推理档位：value 发给上游，description 只负责用户界面展示。 */
export interface ReasoningEffortOption {
  value: ReasoningEffort
  description: string
}

/** allowed_efforts JSON 的兼容存储形态；旧记录是字符串，新记录统一写对象。 */
export type StoredReasoningEffortOption = ReasoningEffort | ReasoningEffortOption

/** 图片生成基础选项 */
export interface ImageOptions {
  size?: string
  quality?: string
  background?: string
}

/** 用户可调 + 模型默认参数 */
export interface ModelParams {
  temperature?: number
  top_p?: number
  verbosity?: 'low' | 'medium' | 'high'
  max_output_tokens?: number
  reasoning_effort?: ReasoningEffort
  web_search?: boolean
  x_search?: boolean
  image?: ImageOptions
}

/** 管理员硬参数：强制合并进上游请求，不暴露给普通用户（如 reasoning.summary='auto'、store=false、include） */
export type ModelHardParams = Record<string, unknown>

/** 按模型定价（USD / 每 100 万 token）；留空的项不计入成本估算。 */
export interface ModelPricing {
  /** 既未写入缓存、也未从缓存读取的普通输入 token 单价。 */
  input?: number
  /** 写入提示词缓存的输入 token 单价。未配置时成本估算回退到普通输入价。 */
  cacheWriteInput?: number
  /** 从提示词缓存读取的输入 token 单价。未配置时成本估算回退到普通输入价。 */
  cachedInput?: number
  output?: number
  image?: number
}

export type ModelKind = 'responses' | 'chat' | 'anthropic' | 'image'

/**
 * 模型在用户端的开放范围。
 * - all：对所有已登录用户开放；
 * - selected：仅对 model_user_access 中明确授权的用户开放。
 *
 * 该范围与 models.enabled 相互独立：enabled 是全局总开关，accessMode 是用户范围。
 */
export type ModelAccessMode = 'all' | 'selected'

/** web_search 工具的动作类型：上游把三者都记为一次 `web_search_call`。 */
export type WebSearchActionType = 'search' | 'open_page' | 'find_in_page'

/**
 * x_search（xAI，检索 X 站内内容）的动作类型。
 * 上游把每个子工具单独记为一次 server-side `custom_tool_call`，工具名即动作；
 * `x_search` 是未知 `x_*` 子工具的兜底归类，保证上游新增能力时仍可展示。
 */
export type XSearchActionType =
  | 'x_keyword_search'
  | 'x_semantic_search'
  | 'x_user_search'
  | 'x_thread_fetch'
  | 'x_search'

export type SearchActionType = WebSearchActionType | XSearchActionType

/**
 * 一步已完成的检索动作（存于 messages.search_actions，按发生顺序）。
 * web_search 与 x_search 共用一个有序数组，以保留两类检索真实的交错次序；
 * 具体动作要等调用完成后的 output item 才给出，查询词在协议上是可选信息。
 */
export interface SearchAction {
  type: SearchActionType
  /** 服务端搜索工具以 HTTP 200 返回的业务错误码；仅失败调用存在。 */
  error?: string
  /** 检索类动作实际执行的查询词（web 一次调用可含多条，X 每次一条）。 */
  queries?: string[]
  /** open_page / find_in_page：目标页面 URL。 */
  url?: string
  /** find_in_page：页内查找的文本模式。 */
  pattern?: string
  /** x_search：限定检索的 X 账号（已去掉 @）。 */
  handles?: string[]
  /** x_search：排除的 X 账号（已去掉 @）。 */
  excludedHandles?: string[]
  /** x_search：检索时间范围下界（YYYY-MM-DD）。 */
  fromDate?: string
  /** x_search：检索时间范围上界（YYYY-MM-DD）。 */
  toDate?: string
  /** x_keyword_search：排序模式，上游原值（如 Latest / Top）。 */
  mode?: string
  /** x_thread_fetch：目标帖子 ID。 */
  postId?: string
}

/** web_search 引用注释（Responses API 扁平结构） */
export interface UrlCitation {
  type: 'url_citation'
  url: string
  title: string
  start_index: number
  end_index: number
}

/** 消息内容部件，存于 messages.content。图片/文件用 attachment_id 引用，不内联 base64。 */
export type ContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string; annotations?: UrlCitation[] }
  | { type: 'input_image'; attachment_id: string; detail?: 'auto' | 'low' | 'high' }
  | {
      type: 'input_file'
      attachment_id: string
      filename: string
      /** 文件卡片展示元数据；旧消息可能没有，由消息 DTO 查询附件表后补齐。 */
      mime?: string
      byte_size?: number
    }
  | { type: 'image_result'; attachment_id: string; revised_prompt?: string }

export interface MessageUsage {
  /** 上游报告的总输入 token，包含缓存写入与缓存读取 token。 */
  inputTokens: number
  /** 本次写入提示词缓存的输入 token。 */
  cacheWriteTokens: number
  /** 本次从提示词缓存读取的输入 token。 */
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}

export type MessageStatus = 'complete' | 'streaming' | 'interrupted' | 'error'

export type RunState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'canceled'
  | 'interrupted'

/** 主题偏好（持久化到 user_settings.theme） */
export type ThemePreference = 'system' | 'light' | 'dark'

/** 消息正文字号档位 */
export type MessageFontSize = 'small' | 'medium' | 'large'

/** 消息时间显示格式：仅时间 / 日期+时间 */
export type MessageTimeFormat = 'time' | 'datetime'

/** ChatGPT 风重点色：驱动用户消息气泡与发送按钮。 */
export type AccentColor = 'default' | 'blue' | 'green' | 'yellow' | 'pink' | 'orange' | 'purple'

/** 模型选择器列表视图：平铺（分组标题可折叠）/ 二级目录（先选分组再钻取模型）。 */
export type ModelPickerView = 'flat' | 'tree'

/**
 * 账户级用户偏好：服务端为源（持久化到 user_settings.preferences），
 * 前端以 localStorage 作首屏缓存避免闪烁。注意区别于 store/chat.ts 里的
 * 编排器临时态（选中模型 / 联网 / 思考等级 / 图片选项）。
 */
export interface UserPreferences {
  // —— 聊天行为 ——
  /** 打开对话时自动滚动到最新消息 */
  autoScrollOnOpen: boolean
  /** 显示「滚动到底部」浮动按钮 */
  showScrollToBottom: boolean
  /** 消息时间轴导航：聊天右侧展示用户消息快捷列表，点击跳转（仅桌面端视图） */
  showTimelineNav: boolean
  /** 新聊天渐变光晕背景：桌面端空会话输入框后方的柔和渐变背景 */
  showNewChatGradientGlow: boolean
  /** 桌面端按 Enter 发送（关闭则 Enter 换行、Ctrl/⌘+Enter 发送） */
  sendOnEnterDesktop: boolean
  /** 手机端按 Enter 发送（关闭则 Enter 换行，点发送按钮发送） */
  sendOnEnterMobile: boolean
  /** 默认展开推理摘要（关闭则推理摘要默认保持折叠，不随生成自动展开） */
  defaultExpandReasoning: boolean
  /** 模型选择器的列表视图：平铺（分组标题可折叠）/ 二级目录（先选分组再选模型） */
  modelPickerView: ModelPickerView
  // —— 消息显示 ——
  /** 重点色：用户消息气泡、设置菜单色点与发送按钮 */
  accentColor: AccentColor
  /** 正文字号档位 */
  messageFontSize: MessageFontSize
  /** 在每条消息上显示时间 */
  showMessageTime: boolean
  /** 消息时间格式：仅时间 / 日期+时间 */
  messageTimeFormat: MessageTimeFormat
  /** 在助手消息上显示所用模型名 */
  showModelLabel: boolean
  /** 在助手消息下方显示 Token / TPS / 耗时 明细 */
  showUsageStats: boolean
}
