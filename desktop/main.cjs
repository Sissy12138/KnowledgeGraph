const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const path = require('path')

const HOST = '127.0.0.1'
const BLANK_EDITION = app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'seed-data', 'blank-edition.marker'))
const FRONTEND_PORT = BLANK_EDITION ? 17841 : 17831
const BACKEND_PORT = BLANK_EDITION ? 17842 : 17832
const WORKER_PORT = BLANK_EDITION ? 17843 : 17833

let mainWindow = null
let webServer = null
let backend = null
let worker = null
let quitting = false

const runtime = {
  desktop: true,
  version: app.getVersion(),
  backend: 'starting',
  worker: 'starting',
}

function paths() {
  const root = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..')
  const dataDir = path.join(app.getPath('userData'), BLANK_EDITION ? 'data-blank-v0.4.0' : 'data-full-v0.3.0')
  const logDir = path.join(app.getPath('logs'), 'services')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(logDir, { recursive: true })
  return {
    root,
    frontend: app.isPackaged ? path.join(root, 'frontend') : path.join(root, 'frontend', 'dist'),
    database: path.join(dataDir, 'yanzhitu.sqlite3'),
    seedDatabase: app.isPackaged ? path.join(root, 'seed-data', BLANK_EDITION ? 'yanzhitu-blank.sqlite3' : 'yanzhitu-full.sqlite3') : null,
    logDir,
    service: app.isPackaged ? path.join(root, 'service-runtime', 'yanzhitu-service') : null,
  }
}

function log(name, text) {
  const target = path.join(paths().logDir, `${name}.log`)
  fs.appendFileSync(target, `${new Date().toISOString()} ${text}`)
}

function json(response, status, body) {
  const data = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
  })
  response.end(data)
}

function proxyApi(request, response) {
  const upstream = http.request({
    hostname: HOST,
    port: BACKEND_PORT,
    path: request.url,
    method: request.method,
    headers: request.headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  upstream.on('error', () => json(response, 502, {
    error: {
      code: 'BACKEND_OFFLINE',
      message: '本地数据服务正在启动，请稍后重试。',
      retryable: true,
      details: null,
      requestId: 'desktop',
    },
  }))
  request.pipe(upstream)
}

function serveFrontend(request, response) {
  const frontend = paths().frontend
  let pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname)
  if (pathname === '/') pathname = '/index.html'
  let target = path.resolve(frontend, `.${pathname}`)
  if (!target.startsWith(path.resolve(frontend)) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    target = path.join(frontend, 'index.html')
  }
  if (!fs.existsSync(target)) {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('应用前端文件缺失。')
    return
  }
  const mime = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
  }
  response.writeHead(200, {
    'Content-Type': `${mime[path.extname(target)] ?? 'application/octet-stream'}; charset=utf-8`,
    'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  fs.createReadStream(target).pipe(response)
}

function startWebServer() {
  webServer = http.createServer((request, response) => {
    if (request.url === '/desktop/status') return json(response, 200, runtime)
    if (request.url.startsWith('/api/')) return proxyApi(request, response)
    return serveFrontend(request, response)
  })
  webServer.on('error', (error) => {
    dialog.showErrorBox('研知图启动失败', `无法启动本地页面服务：${error.message}`)
    app.quit()
  })
  webServer.listen(FRONTEND_PORT, HOST)
}

function serviceCommand(role, args) {
  const appPaths = paths()
  if (app.isPackaged) return { command: appPaths.service, args: [role, ...args], cwd: appPaths.root }
  return {
    command: process.env.YANZHITU_PYTHON || 'python3',
    args: ['-m', role === 'backend' ? 'backend.api' : 'middleware-b.scripts.run_live_worker', ...args],
    cwd: appPaths.root,
  }
}

function launchService(name, role, args) {
  const command = serviceCommand(role, args)
  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    env: { ...process.env, PYTHONPATH: command.cwd },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  runtime[name] = 'running'
  child.stdout.on('data', (data) => log(name, data.toString()))
  child.stderr.on('data', (data) => log(name, data.toString()))
  child.on('error', (error) => {
    runtime[name] = 'failed'
    log(name, `${error.stack ?? error.message}\n`)
  })
  child.on('exit', (code, signal) => {
    runtime[name] = quitting ? 'stopped' : 'failed'
    log(name, `exit code=${code} signal=${signal}\n`)
  })
  return child
}

function waitForBackend(attempts = 80) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      const request = http.get(`http://${HOST}:${BACKEND_PORT}/healthz`, (response) => {
        response.resume()
        if (response.statusCode === 200) return resolve()
        if (remaining <= 1) return reject(new Error('后端健康检查失败'))
        setTimeout(() => check(remaining - 1), 250)
      })
      request.on('error', () => {
        if (remaining <= 1) reject(new Error('后端未能在 20 秒内启动'))
        else setTimeout(() => check(remaining - 1), 250)
      })
    }
    check(attempts)
  })
}

async function startServices() {
  const appPaths = paths()
  if (app.isPackaged && !fs.existsSync(appPaths.service)) {
    runtime.backend = 'installation-error'
    runtime.worker = 'stopped'
    dialog.showErrorBox('研知图安装不完整', '没有找到随应用附带的本地分析服务。')
    return
  }
  if (!fs.existsSync(appPaths.database) && appPaths.seedDatabase && fs.existsSync(appPaths.seedDatabase)) {
    fs.copyFileSync(appPaths.seedDatabase, appPaths.database)
    log('desktop', BLANK_EDITION ? '已初始化空白文献数据库。\n' : '已初始化原有真实文献与分析数据库。\n')
  }
  backend = launchService('backend', 'backend', [
    '--database', appPaths.database, '--host', HOST, '--port', String(BACKEND_PORT),
  ])
  try {
    await waitForBackend()
  } catch (error) {
    runtime.backend = 'failed'
    log('desktop', `${error.message}\n`)
    return
  }
  worker = launchService('worker', 'worker', [
    '--a-base-url', `http://${HOST}:${BACKEND_PORT}`, '--watch',
    '--health-port', String(WORKER_PORT),
    '--log-file', path.join(appPaths.logDir, 'analysis-worker.log'),
    '--status-file', path.join(appPaths.logDir, 'analysis-worker.status.json'),
  ])
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1080, minHeight: 680,
    title: '研知图', show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  void mainWindow.loadURL(`http://${HOST}:${FRONTEND_PORT}/graph`)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://${HOST}:${FRONTEND_PORT}/`)) void mainWindow.loadURL(url)
    else if (/^(https?:|zotero:)\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.on('second-instance', () => {
  if (!mainWindow) createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(() => {
  startWebServer()
  createWindow()
  void startServices()
})

app.on('activate', () => { if (!mainWindow && webServer) createWindow() })

app.on('before-quit', () => {
  quitting = true
  worker?.kill()
  backend?.kill()
  webServer?.close()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
