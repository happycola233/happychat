import { isIP } from 'node:net'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { env } from '../env'

const X_FORWARDED_FOR_HEADER = 'x-forwarded-for'
const IPV4_MAPPED_PREFIX = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i
const BRACKETED_ADDRESS = /^\[([^\]]+)](?::\d+)?$/
const IPV4_WITH_PORT = /^([^:]+):\d+$/

function normalizeIpAddress(rawAddress: string | undefined): string | null {
  if (!rawAddress) return null

  const trimmedAddress = rawAddress.trim()
  if (!trimmedAddress) return null

  const bracketedMatch = BRACKETED_ADDRESS.exec(trimmedAddress)
  const ipv4WithPortMatch = IPV4_WITH_PORT.exec(trimmedAddress)
  const address = bracketedMatch?.[1] ?? ipv4WithPortMatch?.[1] ?? trimmedAddress
  const mappedIpv4 = IPV4_MAPPED_PREFIX.exec(address)?.[1]
  const normalizedAddress = mappedIpv4 ?? address

  return isIP(normalizedAddress) === 0 ? null : normalizedAddress
}

function firstValidAddress(headerValue: string | undefined): string | null {
  if (!headerValue) return null
  for (const rawAddress of headerValue.split(',')) {
    const address = normalizeIpAddress(rawAddress)
    if (address) return address
  }
  return null
}

function getSocketAddress(c: Context): string | undefined {
  // Hono 的 app.request() 测试上下文没有 Node socket；生产 Node Server 上下文始终具备。
  try {
    return getConnInfo(c).remote.address
  } catch {
    return undefined
  }
}

/**
 * 按部署配置解析客户端 IP。请求头默认一律不可信；调用方不得自行读取代理头。
 */
export function resolveClientIp(c: Context): string | null {
  if (env.CLIENT_IP_HEADER) {
    return firstValidAddress(c.req.header(env.CLIENT_IP_HEADER))
  }

  if (env.TRUSTED_PROXY_HOPS > 0) {
    const forwardedChain = c.req.header(X_FORWARDED_FOR_HEADER)?.split(',') ?? []
    const socketAddress = getSocketAddress(c)
    if (!socketAddress) return null

    // socket 是完整代理链最右侧的一跳；nginx 的 XFF 本身不会包含 nginx 地址。
    const addressChain = [...forwardedChain, socketAddress]
    const candidateIndex = addressChain.length - env.TRUSTED_PROXY_HOPS - 1
    return candidateIndex < 0 ? null : normalizeIpAddress(addressChain[candidateIndex])
  }

  return normalizeIpAddress(getSocketAddress(c))
}
