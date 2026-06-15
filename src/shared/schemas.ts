import { z } from "zod";
import type { ModelCapabilities } from "./types.js";

export const emailSchema = z.string().email("请输入有效邮箱");
export const passwordSchema = z.string().min(8, "密码至少需要 8 个字符");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "请输入密码")
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1, "请输入昵称").max(40, "昵称过长"),
  inviteCode: z.string().optional()
});

export const providerInputSchema = z.object({
  name: z.string().min(1, "请输入 Provider 名称").max(80),
  baseUrl: z.string().url("请输入有效 Base URL"),
  apiKey: z.string().min(1, "请输入 API Key"),
  enabled: z.boolean().default(true)
});

export const providerPatchSchema = providerInputSchema.partial();

export const modelCapabilitiesSchema = z.object({
  text: z.boolean(),
  imageInput: z.boolean(),
  fileInput: z.boolean(),
  webSearch: z.boolean(),
  reasoning: z.boolean(),
  reasoningSummary: z.boolean(),
  imageGeneration: z.boolean()
}) satisfies z.ZodType<ModelCapabilities>;

export const reasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]);

export const modelPatchSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  type: z.enum(["chat", "image"]).optional(),
  capabilities: modelCapabilitiesSchema.optional(),
  defaultSystemPrompt: z.string().optional(),
  defaultReasoningEffort: reasoningEffortSchema.optional(),
  defaultWebSearch: z.boolean().optional(),
  defaultParams: z.record(z.string(), z.unknown()).optional(),
  extraParams: z.record(z.string(), z.unknown()).optional(),
  hardParams: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional()
});

export const inviteInputSchema = z.object({
  maxUses: z.number().int().min(1).max(999).default(1),
  expiresAt: z.string().datetime().nullable().optional()
});

export const createConversationSchema = z.object({
  title: z.string().max(120).optional()
});

export const imageOptionsSchema = z.object({
  size: z.enum(["auto", "1024x1024", "1536x1024", "1024x1536"]).optional(),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  format: z.enum(["png", "jpeg", "webp"]).optional(),
  count: z.number().int().min(1).max(4).optional()
});

export const chatOptionsSchema = z.object({
  webSearch: z.boolean().optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  imageGeneration: z.boolean().optional(),
  imageOptions: imageOptionsSchema.optional()
});

export const sendMessageSchema = z.object({
  content: z.string().max(100000).default(""),
  modelId: z.string().min(1, "请选择模型"),
  parentNodeId: z.string().nullable().optional(),
  attachmentIds: z.array(z.string()).default([]),
  options: chatOptionsSchema.default({})
});

export const editMessageSchema = sendMessageSchema.extend({
  targetNodeId: z.string().min(1)
});

export const preferencesSchema = z.object({
  currentModelId: z.string().nullable().optional(),
  webSearchEnabled: z.boolean().optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  imageOptions: imageOptionsSchema.optional()
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ProviderInput = z.infer<typeof providerInputSchema>;
export type ModelPatchInput = z.infer<typeof modelPatchSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;
