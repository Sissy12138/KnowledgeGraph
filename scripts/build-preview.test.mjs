import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const previewPath = join(
  repositoryRoot,
  'preview',
  '20260831_yanzhitu_frontend_mock_preview_v01.html',
)

test('build:preview 生成无需外部样式或脚本文件的单文件预览', () => {
  const result = spawnSync('npm run build:preview', {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: true,
  })

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

  const html = readFileSync(previewPath, 'utf8')
  assert.match(html, /<style>[\s\S]+<\/style>/)
  assert.match(html, /<script type="module">[\s\S]+<\/script>/)
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/)
  assert.doesNotMatch(html, /<script[^>]+src=/)
  assert.doesNotMatch(html, /(?:src|href)="\/?assets\//)
})
