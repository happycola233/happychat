import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TagsInput } from './TagsInput'

describe('TagsInput', () => {
  it('只把字段标题关联到文本输入，不把删除按钮嵌入 label', () => {
    const html = renderToStaticMarkup(
      <TagsInput tags={['Flagship', 'Smartest']} onChange={() => undefined} />,
    )

    const labelHtml = html.match(/<label\b[^>]*>[\s\S]*?<\/label>/)?.[0]
    const inputId = labelHtml?.match(/for="([^"]+)"/)?.[1]

    expect(labelHtml).toContain('标签（可选）')
    expect(labelHtml).not.toContain('<button')
    expect(inputId).toBeTruthy()
    expect(html).toContain(`<input id="${inputId}"`)
    expect(html).toContain('aria-label="删除标签 Flagship"')
  })
})
