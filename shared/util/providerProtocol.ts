import type { ModelKind, ProviderProtocol } from '../types/domain'

/** Provider 级协议与模型执行引擎必须一致；OpenAI Provider 仍可混用 Responses/chat/Images。 */
export function providerProtocolSupportsModelKind(
  protocol: ProviderProtocol,
  kind: ModelKind,
): boolean {
  return protocol === 'anthropic' ? kind === 'anthropic' : kind !== 'anthropic'
}
