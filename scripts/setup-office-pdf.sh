#!/usr/bin/env bash
# 为「Word / PowerPoint 上传时转为 PDF」安装 LibreOffice 与字体（Ubuntu 22.04 / 24.04）。可重复执行。
#
# 用法：sudo bash scripts/setup-office-pdf.sh [Windows 字体目录]
#   Windows 字体目录：可选，放入自有 Windows 电脑上的 .ttf / .ttc 字体（微软雅黑、宋体、等线、Calibri 等），
#   转换出的 PDF 字形与行距将与 Office 一致；不提供时使用开源替代字体。
# 执行完成后重启 HappyChat 服务。
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "请使用 sudo 运行：sudo bash $0 [Windows 字体目录]" >&2
  exit 1
fi

windows_font_dir="${1:-}"
if [[ -n "$windows_font_dir" && ! -d "$windows_font_dir" ]]; then
  echo "找不到字体目录：$windows_font_dir" >&2
  exit 1
fi

echo "==> 安装 LibreOffice（官方 PPA 最新稳定版）与字体"
# 系统源的 LibreOffice 版本较旧（24.04 为 24.2），PPTX 的版式还原明显不如新版本。
apt-get update
apt-get install -y software-properties-common
add-apt-repository -y ppa:libreoffice/ppa
apt-get update
# -nogui 版本不依赖图形界面；Math 组件用于渲染 Word 文档中的公式。
apt-get install -y --no-install-recommends \
  libreoffice-writer-nogui libreoffice-impress-nogui libreoffice-math-nogui \
  fontconfig fonts-dejavu-core fonts-noto-cjk fonts-arphic-ukai \
  fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea
# fonts-liberation / carlito / caladea 与 Arial、Times New Roman、Calibri、Cambria 等字体宽度一致，
# fontconfig 自带的度量别名会在缺少原字体时自动使用它们，文字换行与原文档一致。

if [[ -n "$windows_font_dir" ]]; then
  echo "==> 安装 Windows 字体：$windows_font_dir"
  install -d /usr/local/share/fonts/windows
  find "$windows_font_dir" -maxdepth 1 -type f \( -iname '*.ttf' -o -iname '*.ttc' -o -iname '*.otf' \) \
    -exec install -m 644 {} /usr/local/share/fonts/windows/ \;
fi

echo "==> 配置中文字体回退"
# 缺少微软中文字体时按字形风格回退：宋体类用思源宋体，黑体 / 雅黑 / 等线类用思源黑体，楷体用文鼎楷体。
# accept 只在原字体之后追加候选，已安装原字体时仍优先使用原字体。
alias_rules() {
  local fallback="$1"
  shift
  for family in "$@"; do
    printf '  <alias binding="same"><family>%s</family><accept><family>%s</family></accept></alias>\n' \
      "$family" "$fallback"
  done
}
{
  echo '<?xml version="1.0"?>'
  echo '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">'
  echo '<!-- 由 HappyChat scripts/setup-office-pdf.sh 生成，重新执行脚本会覆盖本文件。 -->'
  echo '<fontconfig>'
  alias_rules "Noto Serif CJK SC" SimSun 宋体 NSimSun 新宋体 FangSong 仿宋 FangSong_GB2312 仿宋_GB2312 \
    STSong 华文宋体 STFangsong 华文仿宋 "Songti SC"
  alias_rules "Noto Sans CJK SC" "Microsoft YaHei" 微软雅黑 "Microsoft YaHei UI" DengXian 等线 \
    SimHei 黑体 STHeiti 华文黑体 STXihei 华文细黑 "PingFang SC" "Heiti SC"
  alias_rules "AR PL UKai CN" KaiTi 楷体 KaiTi_GB2312 楷体_GB2312 STKaiti 华文楷体 "Kaiti SC"
  echo '</fontconfig>'
} >/etc/fonts/conf.d/35-happychat-office-cjk.conf

fc-cache -f >/dev/null

echo
echo "==> 安装结果"
soffice --version
for family in 微软雅黑 宋体 等线 楷体 Calibri Arial "Times New Roman"; do
  printf '  %-16s → %s\n' "$family" "$(fc-match -f '%{family[0]}' "$family")"
done
echo
echo "完成。重启 HappyChat 后，日志中出现「文档转 PDF 已就绪」即表示功能已启用。"
