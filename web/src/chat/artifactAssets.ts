import { artifactAssetFileName, type ArtifactAssetId } from '@shared/util/artifactLibraries'

const pendingAssets = new Map<ArtifactAssetId, Promise<string>>()

/** 同源取回需要内联进沙箱的库文本；成功结果在页面会话内复用，失败后允许下次重试。 */
function loadArtifactAsset(id: ArtifactAssetId): Promise<string> {
  let pending = pendingAssets.get(id)
  if (!pending) {
    pending = fetch(`/api/artifact-assets/${artifactAssetFileName(id)}`).then((response) => {
      if (!response.ok) throw new Error(`所需组件加载失败（HTTP ${response.status}）`)
      return response.text()
    })
    pending.catch(() => pendingAssets.delete(id))
    pendingAssets.set(id, pending)
  }
  return pending
}

export async function loadArtifactAssets(
  ids: readonly ArtifactAssetId[],
): Promise<Map<ArtifactAssetId, string>> {
  const texts = await Promise.all(ids.map(loadArtifactAsset))
  return new Map(ids.map((id, index) => [id, texts[index]!]))
}
