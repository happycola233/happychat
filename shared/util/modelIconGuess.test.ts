import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUESSED_ICON_SLUGS, guessModelIconSlug } from './modelIconGuess'

describe('guessModelIconSlug', () => {
  it.each([
    ['gpt-5.6', 'openai'],
    ['gpt-4o-mini', 'openai'],
    ['o3-mini', 'openai'],
    ['chatgpt-4o-latest', 'openai'],
    ['text-embedding-3-large', 'openai'],
    ['gpt-image-2', 'openai'],
    ['dall-e-3', 'dalle-color'],
    ['sora-2', 'sora-color'],
    ['claude-sonnet-5', 'claude-color'],
    ['anthropic/claude-opus-4-20250514', 'claude-color'],
    ['gemini-3-pro-preview', 'gemini-color'],
    ['gemma-3-27b-it', 'gemma-color'],
    ['imagen-4', 'google-color'],
    ['deepseek-v3.2', 'deepseek-color'],
    ['deepseek-reasoner', 'deepseek-color'],
    ['qwen3-max', 'qwen-color'],
    ['qwq-32b', 'qwen-color'],
    ['moonshot-v1-128k', 'kimi-color'],
    ['kimi-k2-0905', 'kimi-color'],
    ['glm-4.6', 'zhipu-color'],
    ['doubao-seed-1.6-thinking', 'doubao-color'],
    ['hunyuan-turbos-latest', 'hunyuan-color'],
    ['minimax-m2', 'minimax-color'],
    ['abab6.5s-chat', 'minimax-color'],
    ['ernie-4.5-turbo', 'wenxin-color'],
    ['step-2-16k', 'stepfun-color'],
    ['yi-large-turbo', 'yi-color'],
    ['baichuan4-turbo', 'baichuan-color'],
    ['internlm2.5-latest', 'internlm-color'],
    ['grok-4-fast', 'grok'],
    ['llama-3.3-70b-instruct', 'meta-color'],
    ['codellama-70b', 'meta-color'],
    ['mistral-large-latest', 'mistral-color'],
    ['pixtral-12b', 'mistral-color'],
    ['sonar-reasoning-pro', 'perplexity-color'],
    ['command-r-plus-08-2024', 'cohere-color'],
    ['phi-4-reasoning', 'microsoft-color'],
    ['llama-3.1-nemotron-70b', 'meta-color'],
    ['dbrx-instruct', 'dbrx-color'],
    ['jamba-1.5-large', 'ai21'],
    ['granite-3.1-8b', 'ibm'],
    ['amazon.nova-pro-v1:0', 'nova-color'],
    ['solar-pro', 'upstage-color'],
    ['voyage-3-large', 'voyage-color'],
    ['flux.1-schnell', 'flux'],
    ['stable-diffusion-3.5-large', 'stability-color'],
    ['kling-v2', 'kling-color'],
  ])('maps %s to %s', (modelId, expected) => {
    expect(guessModelIconSlug(modelId)).toBe(expected)
  })

  it('falls back to the display name when the upstream id is opaque', () => {
    expect(guessModelIconSlug('ep-20250101-abcde', 'Doubao Seed 1.6')).toBe('doubao-color')
    expect(guessModelIconSlug('custom-endpoint-7', 'Claude 内测')).toBe('claude-color')
  })

  it('returns null for models it cannot recognise rather than guessing wrong', () => {
    expect(guessModelIconSlug('my-private-model-v2')).toBeNull()
    expect(guessModelIconSlug('')).toBeNull()
  })

  it('keeps GPT Image separate from DALL·E branding', () => {
    expect(guessModelIconSlug('gpt-image-2')).toBe('openai')
    expect(guessModelIconSlug('openai/gpt-image-2-2026-04-21')).toBe('openai')
    expect(guessModelIconSlug('dall-e-3')).toBe('dalle-color')
  })

  /**
   * 防回归：图标表里写错一个 slug，用户端只会静默显示首字母兜底，不报任何错。
   * 这里直接对着已安装的图标包核对，改表时立刻会红。
   */
  it('only references slugs that exist in the installed icon package', () => {
    const require = createRequire(import.meta.url)
    const iconsDir = join(
      dirname(require.resolve('@lobehub/icons-static-svg/package.json')),
      'icons',
    )
    const available = new Set(readdirSync(iconsDir).map((file) => file.replace(/\.svg$/, '')))
    const missing = GUESSED_ICON_SLUGS.filter((slug) => !available.has(slug))
    expect(missing).toEqual([])
  })
})
