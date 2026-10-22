import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ARTIFACT_ASSETS } from '@shared/util/artifactLibraries'
import { readArtifactAsset, readArtifactAssetGzip, artifactPackageDir } from './artifact-assets'

describe('self-hosted artifact assets', () => {
  it('matches the installed package versions promised to the model', () => {
    for (const asset of Object.values(ARTIFACT_ASSETS)) {
      const manifest = JSON.parse(
        readFileSync(join(artifactPackageDir(asset.packageName), 'package.json'), 'utf8'),
      ) as { version: string }
      expect(manifest.version, asset.packageName).toBe(asset.version)
    }
  })

  it('reads every registered file from node_modules', () => {
    for (const asset of Object.values(ARTIFACT_ASSETS)) {
      expect(readArtifactAsset(asset.id).length, asset.id).toBeGreaterThan(1000)
    }
  })

  it('inlines KaTeX fonts as woff2 data URLs because the sandbox only allows data: fonts', () => {
    const css = readArtifactAsset('katex-css')
    expect(css).toContain('src:url(data:font/woff2;base64,')
    expect(css).not.toMatch(/url\(fonts\//)
  })

  it('serves a precompressed copy with identical content', () => {
    expect(gunzipSync(readArtifactAssetGzip('d3')).toString('utf8')).toBe(readArtifactAsset('d3'))
  })
})
