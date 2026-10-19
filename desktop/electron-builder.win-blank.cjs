const fs = require('fs')
const path = require('path')

const runtime = process.env.YANZHITU_WIN_RUNTIME
if (!runtime || !fs.existsSync(path.join(runtime, 'python.exe'))) {
  throw new Error('设置 YANZHITU_WIN_RUNTIME 为 Windows x64 Python 运行时目录（包含 python.exe）')
}

module.exports = {
  appId: 'com.yanzhitu.researchkg.blank',
  productName: '研知图',
  asar: true,
  directories: {
    app: 'windows-app',
    output: 'dist-win-blank',
    buildResources: 'build',
  },
  files: ['**/*'],
  extraResources: [
    { from: '../frontend/dist', to: 'frontend' },
    { from: '../backend-a', to: 'backend-a', filter: ['**/*', '!data/**', '!__pycache__/**'] },
    { from: '../backend', to: 'backend', filter: ['**/*', '!__pycache__/**'] },
    { from: '../middleware-b', to: 'middleware-b', filter: ['**/*', '!__pycache__/**'] },
    { from: runtime, to: 'runtime' },
    { from: 'seed-data/yanzhitu-blank.sqlite3', to: 'backend-a/data/yanzhitu.sqlite3' },
  ],
  win: {
    target: ['dir'],
    icon: 'build/icon.png',
    artifactName: '研知图-0.4.0-Windows-x64-空白数据版.${ext}',
  },
}
