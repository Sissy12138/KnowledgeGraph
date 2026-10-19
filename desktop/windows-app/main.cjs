const { app, BrowserWindow, safeStorage, shell } = require('electron')
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const http = require('http')
const path = require('path')
const { randomUUID } = require('crypto')
const { createManagedProcess } = require('./managed-process.cjs')
const { resolvePythonRuntime } = require('./runtime-config.cjs')
const { clearSecureModelConfig, loadSecureModelConfig, saveSecureModelConfig } = require('./secure-model-config.cjs')
const { loadModelProfiles, saveModelProfiles, publicModelProfiles } = require('./model-profiles.cjs')

const HOST = '127.0.0.1'
const FRONTEND_PORT = 17841
const BACKEND_PORT = 18042
const SERVICE_STABLE_AFTER_MS = 60000
let backendManager = null
let workerManager = null
let webServer = null
let mainWindow = null
let runtime = { desktop: true, backend: 'starting', worker: 'starting', diagnostics: null }
const hasSingleInstanceLock = app.requestSingleInstanceLock()

function projectPaths() {
  const root = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..')
  const bundledDatabase = path.join(root, 'backend-a', 'data', 'yanzhitu.sqlite3')
  const database = app.isPackaged ? path.join(app.getPath('userData'), 'data-blank-v0.4.0', 'yanzhitu.sqlite3') : bundledDatabase
  if (app.isPackaged && !fs.existsSync(database) && fs.existsSync(bundledDatabase)) {
    fs.mkdirSync(path.dirname(database), { recursive: true })
    fs.copyFileSync(bundledDatabase, database)
  }
  return {
    root,
    frontend: app.isPackaged ? path.join(root, 'frontend') : path.join(root, 'frontend', 'dist'),
    database,
  }
}

function secureModelConfigPath() {
  return path.join(app.getPath('userData'), 'data-blank-v0.4.0', 'model-config.bin')
}

function savedModelConfig() {
  try {
    const profiles = loadModelProfiles(secureModelConfigPath(), safeStorage)
    return profiles.items.find((item) => item.id === profiles.activeId)?.config ?? null
  } catch (error) {
    serviceLogger()({ name: 'desktop', stream: 'stderr', text: `无法读取已保存的模型配置：${error.message}\n` })
    return null
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { reject(error) }
    })
    request.on('error', reject)
  })
}

function backendModelConfig(method, config) {
  return new Promise((resolve, reject) => {
    const body = config ? Buffer.from(JSON.stringify(config)) : null
    const request = http.request({ hostname: HOST, port: BACKEND_PORT, path: '/api/v1/model-config', method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {} }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (response.statusCode >= 300) {
          const error = new Error(result.error?.message ?? '模型配置未被后端接受')
          error.statusCode = response.statusCode
          reject(error)
        }
        else resolve(result)
      })
    })
    request.on('error', reject)
    request.end(body)
  })
}

async function modelProfilesApi(request, response) {
  try {
    const origin = request.headers.origin
    if (origin && origin !== `http://${HOST}:${FRONTEND_PORT}`) return jsonResponse(response, 403, { error: { message: '请求来源不允许' } })
    const profiles = loadModelProfiles(secureModelConfigPath(), safeStorage)
    const route = request.url.split('?')[0]
    if (request.method === 'GET' && route === '/desktop/model-profiles') return jsonResponse(response, 200, publicModelProfiles(profiles))
    const body = await readJsonBody(request)
    if (request.method === 'POST' && route === '/desktop/model-profiles/reveal') {
      const item = profiles.items.find((entry) => entry.id === body.id)
      if (!item) throw new Error('找不到该模型配置')
      return jsonResponse(response, 200, { apiKey: item.config.apiKey })
    }
    let backendMessage = null
    if (request.method === 'POST' && route === '/desktop/model-profiles/activate') {
      const item = profiles.items.find((entry) => entry.id === body.id)
      if (!item) throw new Error('找不到该模型配置')
      profiles.activeId = item.id
    } else if (request.method === 'POST' && route === '/desktop/model-profiles') {
      const old = profiles.items.find((entry) => entry.id === body.id)
      const config = { provider: body.provider, baseUrl: body.baseUrl, model: body.model, apiKey: body.apiKey || old?.config.apiKey }
      const name = String(body.name ?? '').trim()
      if (!name) throw new Error('请填写配置名称')
      if (!config.provider || !config.baseUrl || !config.model || !config.apiKey) throw new Error('服务商、地址、模型和 API Key 均不能为空')
      const item = { id: old?.id ?? randomUUID(), name, config }
      if (old) profiles.items[profiles.items.indexOf(old)] = item
      else profiles.items.push(item)
      profiles.activeId = item.id
    } else if (request.method === 'POST' && route === '/desktop/model-profiles/delete') {
      profiles.items = profiles.items.filter((entry) => entry.id !== body.id)
      if (profiles.activeId === body.id) {
        const next = profiles.items[0]
        profiles.activeId = next?.id ?? null
      }
    } else return jsonResponse(response, 404, { error: { message: '未知配置操作' } })
    const active = profiles.items.find((entry) => entry.id === profiles.activeId)
    try {
      await backendModelConfig(active ? 'POST' : 'DELETE', active?.config)
    } catch (error) {
      if (error.statusCode === 400) throw error
      backendMessage = `配置已保存，本地后端正在同步：${error.message}`
    }
    saveModelProfiles(secureModelConfigPath(), profiles, safeStorage)
    return jsonResponse(response, 200, { ...publicModelProfiles(profiles), backendReady: !backendMessage, backendMessage })
  } catch (error) {
    return jsonResponse(response, 400, { error: { message: error.message } })
  }
}

function findPython() {
  const paths = projectPaths()
  const runtime = resolvePythonRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    projectRoot: paths.root,
    env: process.env,
    platform: process.platform,
  })
  if (!runtime) return null
  const result = spawnSync(runtime.command, ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return result.status === 0 ? { ...runtime, executable: result.stdout.trim() } : null
}

function diagnose() {
  const paths = projectPaths()
  const python = findPython()
  const dependencyCheck = python
    ? spawnSync(python.command, ['-c', 'import httpx, pypdf, pyzotero'], { windowsHide: true })
    : null
  return {
    errorCode: python ? null : (app.isPackaged ? 'BUNDLED_RUNTIME_MISSING' : 'PYTHON_RUNTIME_MISSING'),
    python: python?.executable ?? null,
    pythonSource: python?.source ?? null,
    dependenciesReady: dependencyCheck?.status === 0,
    frontendReady: fs.existsSync(path.join(paths.frontend, 'index.html')),
    databasePath: paths.database,
    databaseExists: fs.existsSync(paths.database),
  }
}

function jsonResponse(response, status, body) {
  const data = Buffer.from(JSON.stringify(body))
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length })
  response.end(data)
}

function proxyApi(request, response) {
  const isModelConfig = request.url === '/api/v1/model-config'
  const body = []
  if (isModelConfig && request.method === 'POST') request.on('data', (chunk) => body.push(chunk))
  const upstream = http.request({
    hostname: HOST,
    port: BACKEND_PORT,
    path: request.url,
    method: request.method,
    headers: request.headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
    upstreamResponse.on('end', () => {
      if ((upstreamResponse.statusCode ?? 500) >= 300 || !isModelConfig) return
      try {
        if (request.method === 'POST') saveSecureModelConfig(secureModelConfigPath(), JSON.parse(Buffer.concat(body).toString('utf8')), safeStorage)
        if (request.method === 'DELETE') clearSecureModelConfig(secureModelConfigPath())
      } catch (error) {
        serviceLogger()({ name: 'desktop', stream: 'stderr', text: `模型配置未持久化：${error.message}\n` })
      }
    })
  })
  upstream.on('error', () => jsonResponse(response, 502, {
    error: { code: 'BACKEND_OFFLINE', message: '本地后端尚未启动', retryable: true, details: null, requestId: 'desktop' },
  }))
  request.pipe(upstream)
}

function serveFrontend(request, response) {
  const frontend = projectPaths().frontend
  let pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname)
  if (pathname === '/') pathname = '/index.html'
  let target = path.resolve(frontend, `.${pathname}`)
  if (!target.startsWith(path.resolve(frontend)) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    target = path.join(frontend, 'index.html')
  }
  if (!fs.existsSync(target)) {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('前端尚未构建。请先运行 frontend 的 npm run build。')
    return
  }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
  response.writeHead(200, { 'Content-Type': `${mime[path.extname(target)] ?? 'application/octet-stream'}; charset=utf-8` })
  fs.createReadStream(target).pipe(response)
}

function startWebServer() {
  webServer = http.createServer((request, response) => {
    if (request.url === '/desktop/status') return jsonResponse(response, 200, runtime)
    if (request.url === '/desktop/restart-backend' && request.method === 'POST') {
      void restartServices()
      return jsonResponse(response, 202, { restarting: true })
    }
    if (request.url.startsWith('/desktop/model-profiles')) return void modelProfilesApi(request, response)
    if (request.url.startsWith('/api/')) return proxyApi(request, response)
    return serveFrontend(request, response)
  })
  webServer.listen(FRONTEND_PORT, HOST)
}

function waitForBackend(attempts = 40) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      http.get(`http://${HOST}:${BACKEND_PORT}/healthz`, (response) => {
        response.resume()
        if (response.statusCode === 200) return resolve()
        if (remaining <= 1) return reject(new Error('后端健康检查失败'))
        setTimeout(() => check(remaining - 1), 250)
      }).on('error', () => {
        if (remaining <= 1) reject(new Error('后端未能在 10 秒内启动'))
        else setTimeout(() => check(remaining - 1), 250)
      })
    }
    check(attempts)
  })
}

function serviceLogger() {
  const logDirectory = app.getPath('logs')
  fs.mkdirSync(logDirectory, { recursive: true })
  const logPath = path.join(logDirectory, 'services.log')
  return ({ name, stream, text }) => {
    const line = `${new Date().toISOString()} [${name}:${stream}] ${text}`
    fs.appendFile(logPath, line, () => undefined)
  }
}

async function restartServices() {
  const hadRunningProcess = Boolean(workerManager || backendManager)
  workerManager?.stop()
  backendManager?.stop()
  workerManager = null
  backendManager = null
  if (hadRunningProcess) await new Promise((resolve) => setTimeout(resolve, 350))
  runtime.diagnostics = diagnose()
  if (!runtime.diagnostics.python || !runtime.diagnostics.dependenciesReady) {
    runtime.backend = 'installation-error'
    runtime.worker = 'stopped'
    return
  }
  const paths = projectPaths()
  const python = runtime.diagnostics.python
  const restoredConfig = savedModelConfig()
  const backendEnv = { ...process.env, PYTHONPATH: paths.root }
  if (restoredConfig) backendEnv.YANZHITU_MODEL_CONFIG = JSON.stringify(restoredConfig)
  const backendOptions = { cwd: paths.root, env: backendEnv, windowsHide: true }
  const workerOptions = { cwd: paths.root, env: { ...process.env, PYTHONPATH: paths.root }, windowsHide: true }
  const writeLog = serviceLogger()
  backendManager = createManagedProcess({
    name: 'backend',
    spawnProcess: () => spawn(python, [
      '-m', 'backend.api', '--database', paths.database, '--host', HOST, '--port', String(BACKEND_PORT),
    ], backendOptions),
    writeLog,
    stableAfterMs: SERVICE_STABLE_AFTER_MS,
    onStateChange: (state) => { runtime.backend = state },
  })
  backendManager.start()
  try {
    await waitForBackend()
  } catch {
    runtime.backend = 'failed'
    return
  }
  const latestConfig = savedModelConfig()
  if (JSON.stringify(latestConfig) !== JSON.stringify(restoredConfig)) {
    try {
      await backendModelConfig(latestConfig ? 'POST' : 'DELETE', latestConfig)
    } catch (error) {
      writeLog({ name: 'desktop', stream: 'stderr', text: `启动期间模型配置同步失败：${error.message}\n` })
    }
  }
  workerManager = createManagedProcess({
    name: 'worker',
    spawnProcess: () => spawn(python, [
      '-m', 'middleware-b.scripts.run_live_worker', '--a-base-url', `http://${HOST}:${BACKEND_PORT}`,
      '--watch', '--health-port', '8766',
    ], workerOptions),
    writeLog,
    stableAfterMs: SERVICE_STABLE_AFTER_MS,
    onStateChange: (state) => { runtime.worker = state },
  })
  workerManager.start()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: '研知图',
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  mainWindow.loadURL(`http://${HOST}:${FRONTEND_PORT}`)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://${HOST}:${FRONTEND_PORT}/`)) {
      void mainWindow.loadURL(url)
      return { action: 'deny' }
    }
    if (/^(https?:|zotero:)\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
    app.focus({ steal: true })
  })
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    app.focus({ steal: true })
  })

  app.whenReady().then(() => {
    startWebServer()
    createWindow()
    void restartServices()
  })
}

app.on('window-all-closed', () => {
  workerManager?.stop()
  backendManager?.stop()
  webServer?.close()
  if (process.platform !== 'darwin') app.quit()
})
