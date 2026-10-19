const fs = require('fs')
const path = require('path')

function resolvePythonRuntime({ isPackaged, resourcesPath, projectRoot, env = process.env, platform = process.platform }) {
  const executable = platform === 'win32' ? 'python.exe' : 'python'
  if (isPackaged) {
    const command = path.join(resourcesPath, 'runtime', executable)
    return fs.existsSync(command) ? { command, source: 'bundled' } : null
  }

  if (env.YANZHITU_PYTHON && fs.existsSync(env.YANZHITU_PYTHON)) {
    return { command: env.YANZHITU_PYTHON, source: 'environment' }
  }
  const venv = path.join(projectRoot, '.venv', platform === 'win32' ? 'Scripts' : 'bin', executable)
  if (fs.existsSync(venv)) return { command: venv, source: 'venv' }
  return { command: platform === 'win32' ? 'python' : 'python3', source: 'path' }
}

module.exports = { resolvePythonRuntime }
