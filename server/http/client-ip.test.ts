import type { Context } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, mockGetConnInfo } = vi.hoisted(() => ({
  mockEnv: {
    CLIENT_IP_HEADER: '',
    TRUSTED_PROXY_HOPS: 0,
  },
  mockGetConnInfo: vi.fn(),
}))

vi.mock('../env', () => ({ env: mockEnv }))
vi.mock('@hono/node-server/conninfo', () => ({ getConnInfo: mockGetConnInfo }))

import { resolveClientIp } from './client-ip'

function contextWithHeaders(headers: Record<string, string> = {}): Context {
  const requestHeaders = new Headers(headers)
  return {
    req: {
      header: (name: string) => requestHeaders.get(name) ?? undefined,
    },
  } as unknown as Context
}

beforeEach(() => {
  mockEnv.CLIENT_IP_HEADER = ''
  mockEnv.TRUSTED_PROXY_HOPS = 0
  mockGetConnInfo.mockReset()
  mockGetConnInfo.mockReturnValue({ remote: { address: '203.0.113.10' } })
})

describe('resolveClientIp', () => {
  it('hops=0 时忽略伪造的 X-Forwarded-For，只取 socket 地址', () => {
    const c = contextWithHeaders({ 'x-forwarded-for': '198.51.100.80' })

    expect(resolveClientIp(c)).toBe('203.0.113.10')
    expect(mockGetConnInfo).toHaveBeenCalledWith(c)
  })

  it('按 hops=1/2 从 XFF 右侧跳过对应地址', () => {
    mockEnv.TRUSTED_PROXY_HOPS = 1
    mockGetConnInfo.mockReturnValue({ remote: { address: '192.0.2.41' } })
    expect(
      resolveClientIp(
        contextWithHeaders({
          'x-forwarded-for': '203.0.113.21',
        }),
      ),
    ).toBe('203.0.113.21')

    mockEnv.TRUSTED_PROXY_HOPS = 2
    expect(
      resolveClientIp(
        contextWithHeaders({
          'x-forwarded-for': '203.0.113.21, 198.51.100.31',
        }),
      ),
    ).toBe('203.0.113.21')
  })

  it('不会把 XFF 中的伪造前缀当作客户端地址', () => {
    mockEnv.TRUSTED_PROXY_HOPS = 2
    mockGetConnInfo.mockReturnValue({ remote: { address: '192.0.2.42' } })

    expect(
      resolveClientIp(
        contextWithHeaders({
          'x-forwarded-for': '192.0.2.200, 203.0.113.22, 198.51.100.32',
        }),
      ),
    ).toBe('203.0.113.22')
  })

  it('支持带方括号和端口的 IPv6', () => {
    mockEnv.TRUSTED_PROXY_HOPS = 1
    mockGetConnInfo.mockReturnValue({ remote: { address: '192.0.2.43' } })

    expect(
      resolveClientIp(
        contextWithHeaders({
          'x-forwarded-for': '[2001:db8::12]:443',
        }),
      ),
    ).toBe('2001:db8::12')
  })

  it('把 IPv4-mapped IPv6 归一成 IPv4', () => {
    mockGetConnInfo.mockReturnValue({ remote: { address: '::ffff:203.0.113.13' } })

    expect(resolveClientIp(contextWithHeaders())).toBe('203.0.113.13')
  })

  it('候选地址非法或链长度不足时返回 null', () => {
    mockEnv.TRUSTED_PROXY_HOPS = 1
    mockGetConnInfo.mockReturnValue({ remote: { address: '192.0.2.44' } })
    expect(resolveClientIp(contextWithHeaders({ 'x-forwarded-for': 'not-an-ip' }))).toBeNull()

    mockEnv.TRUSTED_PROXY_HOPS = 3
    expect(
      resolveClientIp(contextWithHeaders({ 'x-forwarded-for': '203.0.113.14, 198.51.100.34' })),
    ).toBeNull()
  })

  it('CLIENT_IP_HEADER 优先，并读取其中第一个有效地址', () => {
    mockEnv.CLIENT_IP_HEADER = 'cf-connecting-ip'
    mockEnv.TRUSTED_PROXY_HOPS = 2

    expect(
      resolveClientIp(
        contextWithHeaders({
          'cf-connecting-ip': 'not-an-ip, [2001:db8::15]:8443, 203.0.113.25',
          'x-forwarded-for': '192.0.2.205, 203.0.113.35, 198.51.100.45',
        }),
      ),
    ).toBe('2001:db8::15')
    expect(mockGetConnInfo).not.toHaveBeenCalled()
  })
})
