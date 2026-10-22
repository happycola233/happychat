import { RUNTIME_CONTEXT_INSTRUCTIONS } from './runtimeContext'
import { ARTIFACT_PROTOCOL_INSTRUCTIONS } from './artifactProtocol'

export interface AppProtocolOptions {
  /** 模型开启了 Artifacts 站内能力（capabilities.artifacts）。 */
  artifacts: boolean
}

/**
 * 应用固定协议按稳定顺序附加在管理员系统提示词之后。各段文本恒定，同一模型的请求前缀保持一致，
 * 可以持续命中提示词缓存；runtime context 协议对所有文本模型生效，Artifacts 协议随模型能力附加。
 */
export function appendAppProtocols(
  instructions: string | null,
  options: AppProtocolOptions,
): string {
  return [
    instructions,
    RUNTIME_CONTEXT_INSTRUCTIONS,
    options.artifacts ? ARTIFACT_PROTOCOL_INSTRUCTIONS : null,
  ]
    .filter(Boolean)
    .join('\n\n')
}
