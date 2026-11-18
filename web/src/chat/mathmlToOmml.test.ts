// @vitest-environment happy-dom
import katex from 'katex'
import { describe, expect, it } from 'vitest'
import { mathmlToOmml } from './mathmlToOmml'

/** KaTeX 的 MathML → OMML，并去掉每段文字外层的字体 span，便于断言结构。 */
function omml(tex: string, display = false): string {
  const host = document.createElement('div')
  host.innerHTML = katex.renderToString(tex, { output: 'mathml', displayMode: display })
  return mathmlToOmml(host.querySelector('math')!, display).replace(
    /<span style='font-family:"Cambria Math",serif'>|<\/span>/g,
    '',
  )
}

describe('mathmlToOmml', () => {
  it('writes runs, scripts and fractions in Word clipboard dialect', () => {
    expect(omml(String.raw`x^2+\frac{a}{b}`)).toBe(
      '<m:oMath>' +
        '<m:sSup><m:e><i><m:r>x</m:r></i></m:e><m:sup><i><m:r>2</m:r></i></m:sup></m:sSup>' +
        '<i><m:r>+</m:r></i>' +
        '<m:f><m:num><i><m:r>a</m:r></i></m:num><m:den><i><m:r>b</m:r></i></m:den></m:f>' +
        '</m:oMath>',
    )
  })

  it('wraps display math in a math paragraph and turns big operators into n-ary with a body', () => {
    const xml = omml(String.raw`\sum_{i=1}^{n} a_i`, true)

    expect(xml.startsWith('<m:oMathPara><m:oMath><m:nary>')).toBe(true)
    expect(xml).toContain('<m:chr m:val="∑"/><m:limLoc m:val="undOvr"/>')
    expect(xml).toContain('<m:e><m:sSub><m:e><i><m:r>a</m:r></i></m:e>')
    expect(omml(String.raw`\oint_C F`)).toContain(
      '<m:limLoc m:val="subSup"/><m:supHide m:val="on"/>',
    )
  })

  it('turns function names into m:func with the following argument', () => {
    const xml = omml(String.raw`\lim_{x\to 0}\frac{\sin x}{x}`, true)

    expect(xml).toContain('<m:func><m:fName><m:limLow><m:e><m:r>lim</m:r></m:e>')
    // 行内公式的极限下标在右下角，与 KaTeX 排版一致。
    expect(omml(String.raw`\lim_{x\to 0} x`)).toContain(
      '<m:func><m:fName><m:sSub><m:e><m:r>lim</m:r></m:e>',
    )
    expect(xml).toContain(
      '<m:func><m:fName><m:r>sin</m:r></m:fName><m:e><i><m:r>x</m:r></i></m:e></m:func>',
    )
    expect(xml).not.toContain('⁡')
    expect(omml(String.raw`\sin^2 x`)).toContain(
      '<m:func><m:fName><m:sSup><m:e><m:r>sin</m:r></m:e>',
    )
  })

  it('turns stretchy fences into delimiters, including empty sides and middle separators', () => {
    expect(omml(String.raw`\left( \frac{1}{2} \right)`)).toContain(
      '<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:f>',
    )
    expect(omml(String.raw`\left. x \right|`)).toContain(
      '<m:begChr m:val=""/><m:endChr m:val="∣"/>',
    )
    expect(omml(String.raw`\left[ a \middle| b \right]`)).toContain(
      '<m:begChr m:val="["/><m:sepChr m:val="|"/><m:endChr m:val="]"/></m:dPr><m:e><i><m:r>a</m:r></i></m:e><m:e>',
    )
  })

  it('maps accents, bars, primes and letter variants', () => {
    expect(omml(String.raw`\hat{x}`)).toContain('<m:acc><m:accPr><m:chr m:val="̂"/></m:accPr>')
    expect(omml(String.raw`\overline{AB}`)).toContain(
      '<m:bar><m:barPr><m:pos m:val="top"/></m:barPr>',
    )
    expect(omml(String.raw`\overbrace{a}^{n}`)).toContain(
      '<m:limUpp><m:e><m:groupChr><m:groupChrPr><m:chr m:val="⏞"/>',
    )
    expect(omml(String.raw`f'`)).toBe('<m:oMath><i><m:r>f</m:r></i><i><m:r>′</m:r></i></m:oMath>')
    expect(omml(String.raw`\mathbb{R}+\mathcal{L}`)).toContain('<m:r>ℝ</m:r>')
    expect(omml(String.raw`\mathcal{L}`)).toBe('<m:oMath><m:r>ℒ</m:r></m:oMath>')
    expect(omml(String.raw`\mathbf{v}`)).toBe('<m:oMath><b><m:r>v</m:r></b></m:oMath>')
    expect(omml(String.raw`\mathrm{d}x`)).toBe('<m:oMath><m:r>d</m:r><i><m:r>x</m:r></i></m:oMath>')
  })

  it('converts radicals, binomials, matrices and cases', () => {
    expect(omml(String.raw`\sqrt{2}`)).toContain(
      '<m:rad><m:radPr><m:degHide m:val="on"/></m:radPr><m:deg></m:deg>',
    )
    expect(omml(String.raw`\sqrt[3]{x}`)).toContain('<m:rad><m:deg><i><m:r>3</m:r></i></m:deg>')
    expect(omml(String.raw`\binom{n}{k}`)).toContain('<m:f><m:fPr><m:type m:val="noBar"/></m:fPr>')

    const matrix = omml(String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`)
    expect(matrix.match(/<m:mr>/g)).toHaveLength(2)
    expect(matrix.match(/<m:mcJc m:val="center"\/>/g)).toHaveLength(2)

    const cases = omml(String.raw`\begin{cases}x & x>0\\0 & \text{otherwise}\end{cases}`)
    expect(cases).toContain('<m:begChr m:val="{"/><m:endChr m:val=""/>')
    expect(cases).toContain('<m:mcJc m:val="left"/>')
    expect(cases).toContain('<m:r>otherwise</m:r>')
  })

  it('escapes markup so the formula cannot break out of the conditional comment', () => {
    const xml = omml(String.raw`a-->b<c\&d`)

    expect(xml).not.toContain('-->')
    expect(xml).toContain('<m:r>&gt;</m:r>')
    expect(xml).toContain('<m:r>&lt;</m:r>')
    expect(xml).toContain('<m:r>&amp;</m:r>')
  })
})
