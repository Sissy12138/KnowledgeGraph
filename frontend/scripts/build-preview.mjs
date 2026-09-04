import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDirectory = join(repositoryRoot, 'preview-dist')
const sourceHtmlPath = join(buildDirectory, 'preview-entry.html')
const outputDirectory = join(repositoryRoot, 'preview')
const outputHtmlPath = join(
  outputDirectory,
  '20260831_yanzhitu_frontend_mock_preview_v01.html',
)

/** 把 Vite 生成的相对资源路径解析到临时构建目录内。 */
function resolveBuiltAsset(assetPath) {
  const relativePath = assetPath.replace(/^\.\//, '').replace(/^\//, '')
  return join(buildDirectory, relativePath)
}

let html = await readFile(sourceHtmlPath, 'utf8')

const stylesheetMatch = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/)
if (!stylesheetMatch) throw new Error('预览构建未生成可内联的样式文件。')
const css = await readFile(resolveBuiltAsset(stylesheetMatch[1]), 'utf8')
html = html.replace(
  stylesheetMatch[0],
  () => `<style>${css.replaceAll('</style>', '<\\/style>')}</style>`,
)

const scriptMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"[^>]*><\/script>/)
if (!scriptMatch) throw new Error('预览构建未生成可内联的脚本文件。')
const javascript = await readFile(resolveBuiltAsset(scriptMatch[1]), 'utf8')
html = html.replace(
  scriptMatch[0],
  () => `<script type="module">${javascript.replaceAll('</script>', '<\\/script>')}</script>`,
)

if (/(?:src|href)="\/?assets\//.test(html)) {
  throw new Error('单文件预览仍含有外部构建资源。')
}

await mkdir(outputDirectory, { recursive: true })
await writeFile(outputHtmlPath, html, 'utf8')
console.log(`单文件预览已生成：${outputHtmlPath}`)
