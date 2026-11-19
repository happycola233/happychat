import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_ASSETS,
  matchArtifactAsset,
  artifactAssetByFileName,
  artifactAssetCdnUrl,
  artifactAssetFileName,
} from './artifactLibraries'

describe('artifact library matching', () => {
  it.each([
    ['https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js', 'chartjs'],
    ['https://cdn.jsdelivr.net/npm/chart.js', 'chartjs'],
    ['https://cdnjs.cloudflare.com/ajax/libs/Chart.js/2.9.4/Chart.min.js', 'chartjs'],
    ['https://cdn.jsdelivr.net/npm/jsxgraph/distrib/jsxgraphcore.js', 'jsxgraph'],
    ['https://jsxgraph.org/distrib/jsxgraphcore.js', 'jsxgraph'],
    ['https://cdn.plot.ly/plotly-2.35.2.min.js', 'plotly'],
    ['https://d3js.org/d3.v7.min.js', 'd3'],
    ['https://unpkg.com/d3@7', 'd3'],
    ['https://cdn.jsdelivr.net/npm/d3-scale@4', 'd3'],
    ['https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js', 'katex'],
    ['https://cdn.jsdelivr.net/npm/katex/dist/contrib/auto-render.min.js', 'katex-auto-render'],
    ['https://unpkg.com/docx@8.5.0/build/index.umd.js', 'docx'],
    ['https://cdn.jsdelivr.net/npm/docx', 'docx'],
    ['https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', 'xlsx'],
    ['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'xlsx'],
    ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'xlsx'],
    ['https://unpkg.com/xlsx/dist/xlsx.core.min.js', 'xlsx'],
    ['https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js', 'pptxgenjs'],
    ['https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs/dist/pptxgen.min.js', 'pptxgenjs'],
    ['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'jszip'],
  ] as const)('maps the script %s to %s', (url, id) => {
    expect(matchArtifactAsset(url, 'script')).toBe(id)
  })

  it.each([
    'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3',
    'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns',
    'https://cdn.jsdelivr.net/npm/d3-sankey@0.12',
    'https://cdn.jsdelivr.net/npm/katex/dist/contrib/mhchem.min.js',
    'https://cdn.example.com/three.min.js',
    'https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.js',
    'https://cdn.jsdelivr.net/npm/docxtemplater@3.60.0/build/docxtemplater.js',
    'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx-populate/browser/xlsx-populate.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip-utils/0.1.0/jszip-utils.min.js',
  ])('leaves unsupported scripts unmatched: %s', (url) => {
    expect(matchArtifactAsset(url, 'script')).toBeNull()
  })

  it('maps stylesheets separately from scripts', () => {
    expect(
      matchArtifactAsset('https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css', 'style'),
    ).toBe('katex-css')
    expect(matchArtifactAsset('https://jsxgraph.org/distrib/jsxgraph.css', 'style')).toBe(
      'jsxgraph-css',
    )
    expect(matchArtifactAsset('https://fonts.googleapis.com/css2?family=Inter', 'style')).toBeNull()
  })

  it('round-trips versioned file names and prompt URLs through the matcher', () => {
    for (const asset of Object.values(ARTIFACT_ASSETS)) {
      expect(artifactAssetByFileName(artifactAssetFileName(asset.id))).toBe(asset)
      expect(matchArtifactAsset(artifactAssetCdnUrl(asset.id), asset.kind)).toBe(asset.id)
    }
    expect(artifactAssetByFileName('../package.json')).toBeNull()
  })
})
