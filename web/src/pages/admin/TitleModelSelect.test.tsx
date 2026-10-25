import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { TitleModelSelect } from './TitleModelSelect'

const firstModel = {
  id: '019a19cd-f100-7000-8000-000000001101',
  displayName: 'GPT Test',
  providerName: '供应商一',
  modelId: 'gpt-test',
  kind: 'responses' as const,
}

function renderSelection(models: (typeof firstModel)[], value: string) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <TitleModelSelect models={models} value={value} onChange={() => undefined} />
    </MemoryRouter>,
  )
}

describe('TitleModelSelect', () => {
  it('同名模型按供应商区分，并直达选中实例的配置', () => {
    const secondModel = { ...firstModel, id: 'model-2', providerName: '供应商二' }
    const models = [firstModel, secondModel]

    expect(renderSelection(models, firstModel.id)).toContain('供应商一 · gpt-test')
    const secondHtml = renderSelection(models, secondModel.id)
    expect(secondHtml).toContain('供应商二 · gpt-test')
    expect(secondHtml).toContain('href="/admin/models?edit=model-2"')
    expect(secondHtml).not.toContain('配置 model-2')
  })

  it('同一供应商下的同名模型保留各自的上游模型 ID', () => {
    const secondModel = { ...firstModel, id: 'model-2', modelId: 'gpt-test-v2' }
    const html = renderSelection([firstModel, secondModel], secondModel.id)
    expect(html).toContain('供应商一 · gpt-test-v2')
    expect(html).not.toContain('配置 model-2')
  })

  it('名称、供应商和模型 ID 全相同时，用不随排序变化的短编号区分实例', () => {
    const secondModel = { ...firstModel, id: '019a19cd-f100-7000-8000-000000002202' }
    const models = [firstModel, secondModel]

    expect(renderSelection(models, firstModel.id)).toContain('供应商一 · gpt-test · 配置 00001101')
    expect(renderSelection(models, secondModel.id)).toContain('供应商一 · gpt-test · 配置 00002202')
    expect(renderSelection([...models].reverse(), firstModel.id)).toContain(
      '供应商一 · gpt-test · 配置 00001101',
    )
  })

  it('保留自动选择，排除生图模型，自动模式不显示配置入口', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TitleModelSelect
          models={[
            firstModel,
            { ...firstModel, id: 'image-1', displayName: '生图模型', kind: 'image' },
          ]}
          value=""
          onChange={() => undefined}
        />
      </MemoryRouter>,
    )

    expect(html).toContain('自动（首个可用文本模型）')
    expect(html).not.toContain('生图模型')
    expect(html).not.toContain('查看所选模型配置')
    expect(html).not.toContain('配置 00001101')
  })
})
