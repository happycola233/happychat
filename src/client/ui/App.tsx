import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useRef,
  useState
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Image as ImageIcon,
  Loader2,
  LogOut,
  MessageSquarePlus,
  PanelLeft,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  Square,
  Trash2,
  WandSparkles,
  X
} from "lucide-react";
import {
  api,
  openRunEvents,
  type ErrorLogRow,
  type InviteRow,
  type OverviewStats,
  type Preferences
} from "../api.js";
import type {
  AttachmentView,
  ChatOptions,
  ConversationDetail,
  ConversationNodeView,
  ConversationSummary,
  MessagePart,
  MessageView,
  PublicModel,
  PublicProvider,
  PublicUser,
  ReasoningEffort,
  RunEventPayload
} from "../../shared/types.js";
import { reasoningEffortLabels } from "../../shared/types.js";
import { MarkdownView } from "./MarkdownView.js";

type Page = "chat" | "settings" | "admin";
type Toast = { type: "ok" | "error"; text: string };

export function App() {
  const query = useQueryClient();
  const [toast, setToast] = useState<Toast | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const setup = useQuery({ queryKey: ["setup"], queryFn: api.setupStatus });
  const [page, setPage] = useState<Page>("chat");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("happychat.sidebarCollapsed") === "true"
  );

  const notify = (text: string, type: Toast["type"] = "ok") => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 3000);
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("happychat.sidebarCollapsed", String(next));
      return next;
    });
  };

  if (me.isLoading || setup.isLoading) {
    return <FullScreenNote text="正在打开 HappyChat..." />;
  }

  const user = me.data?.user ?? null;
  if (!user) {
    return (
      <>
        <AuthPage
          hasUsers={setup.data?.hasUsers ?? false}
          onDone={() => query.invalidateQueries({ queryKey: ["me"] })}
          notify={notify}
        />
        {toast && <ToastView toast={toast} />}
      </>
    );
  }

  return (
    <div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <Sidebar
        user={user}
        page={page}
        setPage={setPage}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        activeConversationId={activeConversationId}
        onSelectConversation={(id) => {
          setActiveConversationId(id);
          setPage("chat");
        }}
        onDeletedConversation={(id) => {
          localStorage.removeItem(`happychat.activeRun.${id}`);
          setActiveConversationId((current) => (current === id ? null : current));
        }}
        notify={notify}
      />
      <main className="main-surface">
        {page === "chat" && (
          <ChatPage
            conversationId={activeConversationId}
            setConversationId={setActiveConversationId}
            notify={notify}
          />
        )}
        {page === "settings" && <SettingsPage notify={notify} />}
        {page === "admin" && user.role === "admin" && <AdminPage notify={notify} />}
      </main>
      {toast && <ToastView toast={toast} />}
    </div>
  );
}

function AuthPage({
  hasUsers,
  onDone,
  notify
}: {
  hasUsers: boolean;
  onDone: () => void;
  notify: (text: string, type?: Toast["type"]) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">(hasUsers ? "login" : "register");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "login") return api.login({ email, password });
      return api.register({ email, password, name, inviteCode: inviteCode || undefined });
    },
    onSuccess: onDone,
    onError: (error) => notify(error instanceof Error ? error.message : "登录失败", "error")
  });
  return (
    <div className="auth-page">
      <section className="auth-panel">
        <div className="brand-mark">H</div>
        <h1>{hasUsers ? "欢迎回来" : "初始化 HappyChat"}</h1>
        <p>{hasUsers ? "登录后继续你的私人 AI 对话。" : "第一个账号会自动成为管理员。"}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          {mode === "register" && (
            <label>
              昵称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="你的名字"
                required
              />
            </label>
          )}
          <label>
            邮箱
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              required
            />
          </label>
          <label>
            密码
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 个字符"
              type="password"
              required
            />
          </label>
          {mode === "register" && hasUsers && (
            <label>
              邀请码
              <input
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder="请输入管理员给你的邀请码"
                required
              />
            </label>
          )}
          <button className="primary-btn" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="spin" size={16} />}
            {mode === "login" ? "登录" : hasUsers ? "注册" : "创建管理员账号"}
          </button>
        </form>
        {hasUsers && (
          <button
            className="link-btn"
            type="button"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "我有邀请码，注册账号" : "已有账号，返回登录"}
          </button>
        )}
      </section>
    </div>
  );
}

function Sidebar({
  user,
  page,
  setPage,
  collapsed,
  onToggleCollapsed,
  activeConversationId,
  onSelectConversation,
  onDeletedConversation,
  notify
}: {
  user: PublicUser;
  page: Page;
  setPage: (page: Page) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onDeletedConversation: (id: string) => void;
  notify: (text: string, type?: Toast["type"]) => void;
}) {
  const query = useQueryClient();
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: api.conversations,
    enabled: page === "chat"
  });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      query.clear();
      window.location.reload();
    }
  });
  const deleteConversation = useMutation({
    mutationFn: api.deleteConversation,
    onSuccess: (_, conversationId) => {
      notify("会话已删除");
      onDeletedConversation(conversationId);
      query.invalidateQueries({ queryKey: ["conversations"] });
      query.removeQueries({ queryKey: ["conversation", conversationId] });
    },
    onError: (error) => notify(error instanceof Error ? error.message : "删除失败", "error")
  });
  return (
    <aside className="sidebar">
      <div className="side-top">
        <div className="side-title">
          <span className="brand-dot">H</span>
          <span>HappyChat</span>
        </div>
        <button
          className="icon-btn"
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          type="button"
          onClick={onToggleCollapsed}
        >
          <PanelLeft size={18} />
        </button>
      </div>
      <nav className="side-nav">
        <button className={page === "chat" ? "active" : ""} onClick={() => setPage("chat")}>
          <Bot size={18} /> <span>聊天</span>
        </button>
        <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>
          <Settings size={18} /> <span>设置</span>
        </button>
        {user.role === "admin" && (
          <button className={page === "admin" ? "active" : ""} onClick={() => setPage("admin")}>
            <Shield size={18} /> <span>管理后台</span>
          </button>
        )}
      </nav>
      <div className="side-section">
        <div className="side-section-title">最近会话</div>
        <div className="conversation-list">
          {conversations.data?.map((conversation) => (
            <ConversationLink
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeConversationId}
              onSelect={onSelectConversation}
              onDelete={(id) => {
                const confirmed = window.confirm("确定删除这个会话吗？删除后不会再显示在侧边栏。");
                if (confirmed) deleteConversation.mutate(id);
              }}
            />
          ))}
          {conversations.data?.length === 0 && <div className="empty-mini">还没有会话</div>}
        </div>
      </div>
      <div className="side-user">
        <div>
          <strong>{user.name}</strong>
          <span>{user.role === "admin" ? "管理员" : "普通用户"}</span>
        </div>
        <button
          className="icon-btn"
          title="退出登录"
          onClick={() => {
            notify("已退出登录");
            logout.mutate();
          }}
        >
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  );
}

function ConversationLink({
  conversation,
  active,
  onSelect,
  onDelete
}: {
  conversation: ConversationSummary;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={active ? "conversation-item active" : "conversation-item"}>
      <button type="button" className="conversation-link" onClick={() => onSelect(conversation.id)}>
        {conversation.title}
      </button>
      <button
        type="button"
        className="conversation-delete"
        title="删除会话"
        onClick={() => onDelete(conversation.id)}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function ChatPage({
  conversationId,
  setConversationId,
  notify
}: {
  conversationId: string | null;
  setConversationId: Dispatch<SetStateAction<string | null>>;
  notify: (text: string, type?: Toast["type"]) => void;
}) {
  const query = useQueryClient();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentView[]>([]);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [options, setOptions] = useState<ChatOptions>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: api.conversations });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.preferences });

  useEffect(() => {
    if (!conversationId && conversations.data?.[0]) setConversationId(conversations.data[0].id);
  }, [conversationId, conversations.data]);

  useEffect(() => {
    if (!conversationId) return;
    const remembered = localStorage.getItem(`happychat.activeRun.${conversationId}`);
    if (remembered) setActiveRun(remembered);
  }, [conversationId]);

  const detail = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => api.conversation(conversationId!),
    enabled: Boolean(conversationId)
  });

  const selectedModelId = prefs.data?.currentModelId || models.data?.[0]?.id || "";
  const selectedModel =
    models.data?.find((model) => model.id === selectedModelId) ?? models.data?.[0];
  const activeMessages = activePathMessages(detail.data);
  const hasCompletedActiveRunMessage = activeMessages.some(({ node, message }) =>
    isCompletedActiveRunMessage(node, message, activeRun)
  );
  const visibleMessages = activeMessages.filter(
    ({ node, message }) => !isStreamingPlaceholder(node, message, activeRun)
  );
  const showStreamingBubble = Boolean(
    streamReasoning || streamText || (activeRun && !hasCompletedActiveRunMessage)
  );

  useEffect(() => {
    if (!activeRun || !conversationId) return;
    const source = openRunEvents(activeRun, (payload) => {
      handleRunEvent(payload, {
        setStreamText,
        setStreamReasoning,
        onDone: () => {
          localStorage.removeItem(`happychat.activeRun.${conversationId}`);
          setActiveRun(null);
          setStreamText("");
          setStreamReasoning("");
          query.invalidateQueries({ queryKey: ["conversation", conversationId] });
          query.invalidateQueries({ queryKey: ["conversations"] });
        },
        notify
      });
    });
    return () => source.close();
  }, [activeRun, conversationId, notify, query]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [visibleMessages.length, streamText, streamReasoning]);

  const createConversation = useMutation({
    mutationFn: () => api.createConversation(),
    onSuccess: (res) => {
      setConversationId(res.id);
      query.invalidateQueries({ queryKey: ["conversations"] });
    }
  });

  const savePrefs = useMutation({
    mutationFn: api.savePreferences,
    onSuccess: () => query.invalidateQueries({ queryKey: ["preferences"] })
  });

  const submit = useMutation({
    mutationFn: async () => {
      const convId = conversationId ?? (await api.createConversation()).id;
      setConversationId(convId);
      const body = {
        content: draft,
        modelId: selectedModel?.id ?? "",
        parentNodeId: detail.data?.currentLeafNodeId,
        attachmentIds: attachments.map((a) => a.id),
        options
      };
      if (editingNodeId) return api.editMessage(convId, { ...body, targetNodeId: editingNodeId });
      return api.sendMessage(convId, body);
    },
    onSuccess: (res) => {
      setDraft("");
      setAttachments([]);
      setEditingNodeId(null);
      setStreamText("");
      setStreamReasoning("");
      setActiveRun(res.runId);
      localStorage.setItem(`happychat.activeRun.${res.conversationId}`, res.runId);
      query.invalidateQueries({ queryKey: ["conversations"] });
      query.invalidateQueries({ queryKey: ["conversation", res.conversationId] });
    },
    onError: (error) => notify(error instanceof Error ? error.message : "发送失败", "error")
  });

  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        const uploaded = await api.uploadAttachment(file, conversationId);
        setAttachments((prev) => [...prev, uploaded]);
      } catch (error) {
        notify(error instanceof Error ? error.message : "上传失败", "error");
      }
    }
  };

  return (
    <div className="chat-layout">
      <header className="chat-header">
        <div>
          <button className="ghost-btn" onClick={() => createConversation.mutate()}>
            <MessageSquarePlus size={17} /> 新对话
          </button>
        </div>
        <div className="model-controls">
          <select
            value={selectedModel?.id ?? ""}
            onChange={(event) => savePrefs.mutate({ currentModelId: event.target.value })}
          >
            {models.data?.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
          {selectedModel?.capabilities.webSearch && (
            <button
              className={
                (options.webSearch ?? prefs.data?.webSearchEnabled) ? "chip active" : "chip"
              }
              onClick={() =>
                setOptions((prev) => ({
                  ...prev,
                  webSearch: !(prev.webSearch ?? prefs.data?.webSearchEnabled)
                }))
              }
            >
              <Search size={15} /> 联网搜索
            </button>
          )}
          {selectedModel?.capabilities.reasoning && (
            <select
              value={
                options.reasoningEffort ??
                prefs.data?.reasoningEffort ??
                selectedModel.defaultReasoningEffort
              }
              onChange={(event) =>
                setOptions((prev) => ({
                  ...prev,
                  reasoningEffort: event.target.value as ReasoningEffort
                }))
              }
            >
              {Object.entries(reasoningEffortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  思考：{label}
                </option>
              ))}
            </select>
          )}
          {selectedModel?.capabilities.imageGeneration && (
            <button
              className={options.imageGeneration ? "chip active" : "chip"}
              onClick={() =>
                setOptions((prev) => ({ ...prev, imageGeneration: !prev.imageGeneration }))
              }
            >
              <WandSparkles size={15} /> 图片生成
            </button>
          )}
        </div>
      </header>
      <div className="messages" ref={scrollRef}>
        {!conversationId && <EmptyChat />}
        {detail.data &&
          visibleMessages.map(({ node, message }) => (
            <MessageBubble
              key={node.id}
              detail={detail.data}
              node={node}
              message={message}
              onEdit={(text) => {
                setEditingNodeId(node.id);
                setDraft(text);
              }}
              onSwitch={async (nodeId) => {
                await api.switchBranch(detail.data.id, nodeId);
                query.invalidateQueries({ queryKey: ["conversation", detail.data.id] });
              }}
            />
          ))}
        {showStreamingBubble && <StreamingBubble reasoning={streamReasoning} text={streamText} />}
      </div>
      <footer className="composer-wrap">
        {editingNodeId && (
          <div className="edit-banner">
            正在编辑一条用户消息，发送后会创建新的对话分支。
            <button onClick={() => setEditingNodeId(null)}>
              <X size={15} /> 取消
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map((attachment) => (
              <span className="attachment-pill" key={attachment.id}>
                {attachment.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                {attachment.name}
                <button
                  onClick={() =>
                    setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))
                  }
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim() && attachments.length === 0) return;
            submit.mutate();
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => upload(event.target.files)}
          />
          <button
            type="button"
            className="icon-btn"
            onClick={() => fileInputRef.current?.click()}
            title="上传附件"
          >
            <Paperclip size={19} />
          </button>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="给模型发送消息，支持图片和文件..."
            rows={1}
          />
          {activeRun ? (
            <button type="button" className="stop-btn" onClick={() => api.cancelRun(activeRun)}>
              <Square size={16} /> 停止
            </button>
          ) : (
            <button className="send-btn" disabled={submit.isPending || !selectedModel}>
              {submit.isPending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            </button>
          )}
        </form>
      </footer>
    </div>
  );
}

function MessageBubble({
  detail,
  node,
  message,
  onEdit,
  onSwitch
}: {
  detail: ConversationDetail;
  node: ConversationNodeView;
  message?: MessageView;
  onEdit: (text: string) => void;
  onSwitch: (nodeId: string) => void;
}) {
  const siblings = detail.nodes.filter(
    (item) => item.parentId === node.parentId && item.role === node.role
  );
  const index = siblings.findIndex((item) => item.id === node.id);
  const text = message?.contentText ?? "";
  return (
    <article className={`message ${node.role}`}>
      <div className="message-inner">
        {node.role === "assistant" && <div className="avatar">AI</div>}
        <div className="message-card">
          {message?.reasoningSummary && (
            <details className="reasoning-box">
              <summary>思考摘要</summary>
              <MarkdownView content={message.reasoningSummary} />
            </details>
          )}
          {renderParts(message?.parts ?? [], text)}
          <div className="message-actions">
            <button title="复制" onClick={() => navigator.clipboard.writeText(text)}>
              <Copy size={15} />
            </button>
            {node.role === "user" && (
              <button title="编辑并重发" onClick={() => onEdit(text)}>
                <Pencil size={15} />
              </button>
            )}
            {siblings.length > 1 && (
              <span className="branch-switcher">
                <button disabled={index <= 0} onClick={() => onSwitch(siblings[index - 1].id)}>
                  <ChevronLeft size={15} />
                </button>
                {index + 1}/{siblings.length}
                <button
                  disabled={index >= siblings.length - 1}
                  onClick={() => onSwitch(siblings[index + 1].id)}
                >
                  <ChevronRight size={15} />
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function renderParts(parts: MessagePart[], fallback: string) {
  if (parts.length === 0 && fallback) return <MarkdownView content={fallback} />;
  return parts.map((part, idx) => {
    if (part.type === "text") return <MarkdownView key={idx} content={part.text} />;
    if (part.type === "reasoning") return null;
    if (part.type === "image" || part.type === "generated_image")
      return (
        <img
          key={idx}
          className="message-image"
          src={part.url ?? `/api/attachments/${part.attachmentId}`}
          alt={part.name ?? "图片"}
        />
      );
    if (part.type === "file") {
      return (
        <a
          key={idx}
          className="file-card"
          href={`/api/attachments/${part.attachmentId}`}
          target="_blank"
          rel="noreferrer"
        >
          <FileText size={18} /> {part.name ?? "文件"}
        </a>
      );
    }
    return null;
  });
}

function StreamingBubble({ reasoning, text }: { reasoning: string; text: string }) {
  return (
    <article className="message assistant">
      <div className="message-inner">
        <div className="avatar">AI</div>
        <div className="message-card streaming">
          {reasoning && (
            <details className="reasoning-box" open>
              <summary>思考摘要</summary>
              <MarkdownView content={reasoning} />
            </details>
          )}
          <MarkdownView content={text || "正在思考..."} />
          <span className="stream-dot" />
        </div>
      </div>
    </article>
  );
}

function handleRunEvent(
  payload: RunEventPayload,
  helpers: {
    setStreamText: Dispatch<SetStateAction<string>>;
    setStreamReasoning: Dispatch<SetStateAction<string>>;
    onDone: () => void;
    notify: (text: string, type?: Toast["type"]) => void;
  }
) {
  if (payload.kind === "text_delta") helpers.setStreamText((prev) => prev + payload.delta);
  if (payload.kind === "reasoning_delta")
    helpers.setStreamReasoning((prev) => prev + payload.delta);
  if (payload.kind === "message_completed") helpers.onDone();
  if (payload.kind === "error") {
    helpers.notify(payload.message, "error");
    helpers.onDone();
  }
}

function activePathMessages(
  detail?: ConversationDetail
): Array<{ node: ConversationNodeView; message?: MessageView }> {
  if (!detail) return [];
  const byId = new Map(detail.messages.map((message) => [message.id, message]));
  return detail.activePath.map((node) => ({
    node,
    message: node.messageId ? byId.get(node.messageId) : undefined
  }));
}

function isStreamingPlaceholder(
  node: ConversationNodeView,
  message: MessageView | undefined,
  activeRun: string | null
) {
  if (!activeRun || node.role !== "assistant") return false;
  if (node.runId !== activeRun && message?.runId !== activeRun) return false;
  return !hasRenderableMessageContent(message);
}

function isCompletedActiveRunMessage(
  node: ConversationNodeView,
  message: MessageView | undefined,
  activeRun: string | null
) {
  if (!activeRun || node.role !== "assistant") return false;
  if (node.runId !== activeRun && message?.runId !== activeRun) return false;
  return hasRenderableMessageContent(message);
}

function hasRenderableMessageContent(message: MessageView | undefined) {
  if (!message) return false;
  return Boolean(
    message.contentText.trim() || message.reasoningSummary?.trim() || message.parts.length > 0
  );
}

function EmptyChat() {
  return (
    <div className="empty-chat">
      <Bot size={42} />
      <h2>开始新的对话</h2>
      <p>选择模型后发送消息，可以附加图片或文件。</p>
    </div>
  );
}

function SettingsPage({ notify }: { notify: (text: string, type?: Toast["type"]) => void }) {
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: api.preferences });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const [local, setLocal] = useState<Preferences | null>(null);
  useEffect(() => {
    if (prefs.data) setLocal(prefs.data);
  }, [prefs.data]);
  const save = useMutation({
    mutationFn: () => api.savePreferences(local ?? {}),
    onSuccess: () => notify("设置已保存"),
    onError: (error) => notify(error instanceof Error ? error.message : "保存失败", "error")
  });
  return (
    <Panel title="个人设置" subtitle="这些选项会记住到你的账号，下次打开自动使用。">
      {local && (
        <div className="form-grid">
          <label>
            默认模型
            <select
              value={local.currentModelId ?? ""}
              onChange={(event) => setLocal({ ...local, currentModelId: event.target.value })}
            >
              <option value="">自动选择第一个可用模型</option>
              {models.data?.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={local.webSearchEnabled}
              onChange={(event) => setLocal({ ...local, webSearchEnabled: event.target.checked })}
            />
            默认开启联网搜索
          </label>
          <label>
            默认思考深度
            <select
              value={local.reasoningEffort}
              onChange={(event) =>
                setLocal({ ...local, reasoningEffort: event.target.value as ReasoningEffort })
              }
            >
              {Object.entries(reasoningEffortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-btn compact" onClick={() => save.mutate()}>
            保存设置
          </button>
        </div>
      )}
    </Panel>
  );
}

function AdminPage({ notify }: { notify: (text: string, type?: Toast["type"]) => void }) {
  const [tab, setTab] = useState<
    "overview" | "providers" | "models" | "users" | "invites" | "errors"
  >("overview");
  return (
    <div className="admin-page">
      <div className="admin-tabs">
        {[
          ["overview", "统计"],
          ["providers", "Provider"],
          ["models", "模型"],
          ["users", "用户"],
          ["invites", "邀请码"],
          ["errors", "错误日志"]
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id as typeof tab)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewAdmin />}
      {tab === "providers" && <ProvidersAdmin notify={notify} />}
      {tab === "models" && <ModelsAdmin notify={notify} />}
      {tab === "users" && <UsersAdmin notify={notify} />}
      {tab === "invites" && <InvitesAdmin notify={notify} />}
      {tab === "errors" && <ErrorsAdmin />}
    </div>
  );
}

function OverviewAdmin() {
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: api.admin.overview });
  const data: OverviewStats | undefined = overview.data;
  return (
    <Panel title="聊天统计" subtitle="站点整体使用情况。">
      <div className="stat-grid">
        <Stat label="用户数" value={data?.userTotal ?? 0} />
        <Stat label="会话数" value={data?.convoTotal ?? 0} />
        <Stat label="调用次数" value={data?.runTotal ?? 0} />
        <Stat label="Input tokens" value={data?.usage.inputTokens ?? 0} />
        <Stat label="Output tokens" value={data?.usage.outputTokens ?? 0} />
        <Stat label="Cached input" value={data?.usage.cachedInputTokens ?? 0} />
      </div>
    </Panel>
  );
}

function ProvidersAdmin({ notify }: { notify: (text: string, type?: Toast["type"]) => void }) {
  const query = useQueryClient();
  const providers = useQuery({ queryKey: ["admin", "providers"], queryFn: api.admin.providers });
  const [form, setForm] = useState({
    name: "HappyCola",
    baseUrl: "https://api.example.com/v1",
    apiKey: "",
    enabled: true
  });
  const create = useMutation({
    mutationFn: () => api.admin.createProvider(form),
    onSuccess: () => {
      notify("Provider 已添加");
      query.invalidateQueries({ queryKey: ["admin", "providers"] });
    },
    onError: (error) => notify(error instanceof Error ? error.message : "保存失败", "error")
  });
  return (
    <Panel title="Provider 管理" subtitle="API Key 只保存在服务端，前端不会读取明文。">
      <div className="provider-form">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="名称"
        />
        <input
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          placeholder="Base URL"
        />
        <input
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          placeholder="API Key"
          type="password"
        />
        <button className="primary-btn compact" onClick={() => create.mutate()}>
          <Plus size={16} /> 添加
        </button>
      </div>
      <div className="table-list">
        {providers.data?.map((provider) => (
          <ProviderRowView key={provider.id} provider={provider} notify={notify} />
        ))}
      </div>
    </Panel>
  );
}

function ProviderRowView({
  provider,
  notify
}: {
  provider: PublicProvider;
  notify: (text: string, type?: Toast["type"]) => void;
}) {
  const query = useQueryClient();
  const [upstream, setUpstream] = useState<Array<{ id: string }> | null>(null);
  const verify = useMutation({
    mutationFn: () => api.admin.verifyProvider(provider.id),
    onSuccess: (res) => notify(`连接成功，可见 ${res.count} 个模型`),
    onError: (e) => notify(e instanceof Error ? e.message : "验证失败", "error")
  });
  const load = useMutation({
    mutationFn: () => api.admin.upstreamModels(provider.id),
    onSuccess: setUpstream,
    onError: (e) => notify(e instanceof Error ? e.message : "同步失败", "error")
  });
  const importAll = useMutation({
    mutationFn: () =>
      api.admin.importModels(
        provider.id,
        upstream?.map((m) => m.id)
      ),
    onSuccess: (res) => {
      notify(`已导入 ${res.imported} 个模型`);
      query.invalidateQueries({ queryKey: ["admin", "models"] });
      query.invalidateQueries({ queryKey: ["models"] });
    }
  });
  return (
    <div className="row-card">
      <div>
        <strong>{provider.name}</strong>
        <span>{provider.baseUrl}</span>
      </div>
      <div className="row-actions">
        <button onClick={() => verify.mutate()}>
          <Check size={15} /> 验证
        </button>
        <button onClick={() => load.mutate()}>
          <RefreshCw size={15} /> 拉取模型
        </button>
        {upstream && (
          <button onClick={() => importAll.mutate()}>
            <Plus size={15} /> 一键添加 {upstream.length} 个
          </button>
        )}
      </div>
      {upstream && (
        <div className="model-tags">
          {upstream.map((m) => (
            <span key={m.id}>{m.id}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelsAdmin({ notify }: { notify: (text: string, type?: Toast["type"]) => void }) {
  const query = useQueryClient();
  const modelsQuery = useQuery({ queryKey: ["admin", "models"], queryFn: api.admin.models });
  const update = useMutation({
    mutationFn: (model: PublicModel) => api.admin.updateModel(model.id, model),
    onSuccess: () => {
      notify("模型配置已保存");
      query.invalidateQueries({ queryKey: ["admin", "models"] });
      query.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (e) => notify(e instanceof Error ? e.message : "保存失败", "error")
  });
  return (
    <Panel title="模型管理" subtitle="能力开关会决定前端显示哪些用户可调参数。">
      <div className="model-admin-list">
        {modelsQuery.data?.map((model) => (
          <ModelEditor key={model.id} model={model} onSave={(next) => update.mutate(next)} />
        ))}
      </div>
    </Panel>
  );
}

function ModelEditor({
  model,
  onSave
}: {
  model: PublicModel;
  onSave: (model: PublicModel) => void;
}) {
  const [local, setLocal] = useState(model);
  const capKeys = Object.keys(local.capabilities) as Array<keyof PublicModel["capabilities"]>;
  return (
    <div className="model-editor">
      <div className="model-editor-head">
        <input
          value={local.displayName}
          onChange={(e) => setLocal({ ...local, displayName: e.target.value })}
        />
        <button className="primary-btn compact" onClick={() => onSave(local)}>
          保存
        </button>
      </div>
      <div className="muted">
        {local.providerName} / {local.upstreamId}
      </div>
      <div className="cap-grid">
        {capKeys.map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={local.capabilities[key]}
              onChange={(e) =>
                setLocal({
                  ...local,
                  capabilities: { ...local.capabilities, [key]: e.target.checked }
                })
              }
            />
            {capabilityLabel(key)}
          </label>
        ))}
      </div>
      <textarea
        value={local.defaultSystemPrompt}
        onChange={(e) => setLocal({ ...local, defaultSystemPrompt: e.target.value })}
        placeholder="默认系统提示词"
      />
      <textarea
        value={JSON.stringify(local.hardParams, null, 2)}
        onChange={(e) => setLocal({ ...local, hardParams: safeJson(e.target.value) })}
        placeholder="管理员硬参数 JSON"
      />
    </div>
  );
}

function UsersAdmin({ notify }: { notify: (text: string, type?: Toast["type"]) => void }) {
  const query = useQueryClient();
  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: api.admin.users });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "disabled" }) =>
      api.admin.updateUser(id, { status }),
    onSuccess: () => {
      notify("用户状态已更新");
      query.invalidateQueries({ queryKey: ["admin", "users"] });
    }
  });
  return (
    <Panel title="用户管理" subtitle="普通用户只能看到自己的聊天记录。">
      <div className="table-list">
        {usersQuery.data?.map((user) => (
          <div className="row-card" key={user.id}>
            <div>
              <strong>{user.name}</strong>
              <span>
                {user.email} · {user.role === "admin" ? "管理员" : "普通用户"} ·{" "}
                {user.status === "active" ? "正常" : "停用"}
              </span>
            </div>
            <button
              onClick={() =>
                update.mutate({
                  id: user.id,
                  status: user.status === "active" ? "disabled" : "active"
                })
              }
            >
              {user.status === "active" ? "停用" : "启用"}
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function InvitesAdmin({ notify }: { notify: (text: string, type?: Toast["type"]) => void }) {
  const query = useQueryClient();
  const invites = useQuery({ queryKey: ["admin", "invites"], queryFn: api.admin.invites });
  const create = useMutation({
    mutationFn: () => api.admin.createInvite(1),
    onSuccess: (res) => {
      navigator.clipboard.writeText(res.code);
      notify("邀请码已创建并复制");
      query.invalidateQueries({ queryKey: ["admin", "invites"] });
    }
  });
  return (
    <Panel title="邀请码管理" subtitle="只有持有邀请码的朋友才能注册。">
      <button className="primary-btn compact" onClick={() => create.mutate()}>
        <Plus size={16} /> 创建邀请码
      </button>
      <div className="table-list">
        {invites.data?.map((invite: InviteRow) => (
          <div className="row-card" key={invite.code}>
            <div>
              <strong>{invite.code}</strong>
              <span>
                已用 {invite.uses}/{invite.maxUses} · {invite.disabled ? "已停用" : "可用"}
              </span>
            </div>
            <button onClick={() => navigator.clipboard.writeText(invite.code)}>复制</button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ErrorsAdmin() {
  const errors = useQuery({ queryKey: ["admin", "errors"], queryFn: api.admin.errors });
  return (
    <Panel title="错误日志" subtitle="敏感字段已在服务端脱敏。">
      <div className="table-list">
        {errors.data?.map((error: ErrorLogRow) => (
          <div className="row-card error" key={error.id}>
            <div>
              <strong>{error.message}</strong>
              <span>
                {error.source} · {new Date(error.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Panel({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  return <div className={`toast ${toast.type}`}>{toast.text}</div>;
}

function FullScreenNote({ text }: { text: string }) {
  return (
    <div className="full-note">
      <Loader2 className="spin" /> {text}
    </div>
  );
}

function capabilityLabel(key: keyof PublicModel["capabilities"]): string {
  return {
    text: "文本",
    imageInput: "图片输入",
    fileInput: "文件输入",
    webSearch: "联网搜索",
    reasoning: "思考模型",
    reasoningSummary: "思考摘要",
    imageGeneration: "图片生成"
  }[key];
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
