import { ARTIFACT_BLOCK_LANGUAGE } from '@shared/util/artifactBlocks'
import { ARTIFACT_PROMPT_LIBRARIES, artifactAssetCdnUrl } from '@shared/util/artifactLibraries'

type PromptLibraryId = (typeof ARTIFACT_PROMPT_LIBRARIES)[number]['assetId']

const LIBRARY_PURPOSES: Record<PromptLibraryId, string> = {
  jsxgraph: 'function graphs, geometry, draggable points and sliders',
  chartjs: 'statistics charts',
  plotly: '3D surfaces and scientific plots; it is large, so load it only when needed',
  d3: 'custom data-driven SVG',
  katex: 'math labels; its styles and fonts load automatically',
  docx: 'Word .docx documents, saved via docx.Packer.toBlob',
  xlsx: 'Excel .xlsx spreadsheets and CSV, saved via XLSX.writeFile',
  pptxgenjs: 'PowerPoint .pptx slides, saved via pptx.writeFile',
  jszip: 'zip archives bundling several files',
}

const libraryLines = ARTIFACT_PROMPT_LIBRARIES.map(
  ({ assetId, name, global }) =>
    `- ${name} (${LIBRARY_PURPOSES[assetId]}): <script src="${artifactAssetCdnUrl(assetId)}"></script> → global ${global}`,
).join('\n')

/**
 * 模型开启 Artifacts 站内能力时附加到系统提示词的固定协议。文本在进程内恒定（库清单来自共享注册表），
 * 不会打断前缀缓存；它约定的输出格式、可用库、沙箱权限与主题变量必须与前端沙箱渲染器保持一致。
 * 主题变量只约束界面骨架，插画、艺术与品牌配色放开，需要随明暗变化时用 light-dark()。
 */
export const ARTIFACT_PROTOCOL_INSTRUCTIONS = `<artifact_protocol>
The chat interface renders a fenced code block tagged \`${ARTIFACT_BLOCK_LANGUAGE}\` as a live, interactive artifact inside your answer.

When to use it: add one when a visual or a small working tool makes the answer clearly better, such as function graphs, geometric figures, circuit and timing diagrams, physical waveforms or motion, statistics charts, demos with adjustable parameters, calculators, vector illustrations, or a file the user wants to download. Anything that must be mathematically or numerically accurate belongs in an artifact rather than an image generation tool, which cannot place exact curves, coordinates or values; use image generation for photos, painterly artwork and illustrations, or when the user explicitly asks for a generated image, and when no image generation tool is available, draw illustrations as SVG in an artifact. Skip artifacts when plain text, a table, LaTeX or a Mermaid diagram already does the job. When the user asks for HTML source code, write a normal \`\`\`html block instead.

Format:
- Put it only in the final answer, never in commentary or reasoning, and use at most two per answer.
- The block holds an HTML fragment without <!doctype>, <html>, <head> or <body>. Start it with a <title> naming the artifact; the title becomes the card heading.
- Keep explanations, steps and formulas in the Markdown answer outside the block.

Choosing the technique:
- Static figures such as geometry, force diagrams, circuits, logic gates and timing diagrams: write plain inline <svg> with a viewBox and no library. It is the fastest to produce and keeps every coordinate exact.
- Interactive or data-heavy visuals: vanilla JavaScript with SVG or Canvas, or one of the bundled libraries below.
- Files to download, such as Word documents, spreadsheets, slides, CSV, JSON or images: build the file in JavaScript with a bundled library below (a Blob is enough for text formats, canvas.toBlob for images), then save it from a button through an <a download="name.ext"> link to URL.createObjectURL(blob). Show a short preview of the content next to the button.

Sandbox: the artifact runs isolated from the chat, with no network access, storage, cookies, dialogs, popups or navigation. File downloads work, and so do forms when the submit handler calls event.preventDefault(). Embed all data inline. External scripts are limited to these bundled libraries, each loaded with exactly the tag shown:
${libraryLines}

Layout and style:
- The artifact is about 700px wide on desktop and 340px on phones. Use width:100% and give every chart container an explicit pixel height (never vh units). Keep charts and figures under about 520px tall; tools, games and illustrations that need more room may use up to 900px.
- The chat switches between light and dark mode. Text, axes, grid lines, borders, panels and controls should use the theme variables --hc-fg, --hc-muted, --hc-grid, --hc-border, --hc-surface and --hc-accent, and data series --hc-series-1 to --hc-series-6; these variables are predefined, so never redefine them. Beyond that, use any colors the content calls for, such as in illustrations, artwork, maps, heatmaps or brand palettes. When a custom color should change with the mode, write light-dark(lightColor, darkColor), for example fill: light-dark(#c2410c, #fb923c). Content that uses only fixed colors is shown on a white card in dark mode, like an image.
- Apply theme variables and light-dark() through CSS (a <style> block or style attributes, in SVG too) or currentColor, because SVG presentation attributes such as fill="var(--hc-fg)" are unreliable. In JavaScript, read variables with getComputedStyle(document.documentElement).getPropertyValue(name); light-dark() works only in CSS, so pick mode-specific colors in JavaScript by checking getComputedStyle(document.documentElement).colorScheme === 'dark'.
- Keep the page background transparent unless the artwork paints its own scene.
- Label axes, units and key points in the user's language. With two or more series, add a legend or direct labels. Render math labels with KaTeX.

Users see the rendered artifact rather than its source, so keep the code compact and omit comments.
</artifact_protocol>`
