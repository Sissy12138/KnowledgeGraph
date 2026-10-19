/** 管理桌面端子进程：持续排空输出，并在异常退出后有限次重启。 */
function createManagedProcess({
  name,
  spawnProcess,
  writeLog,
  onStateChange = () => undefined,
  restartDelays = [1000, 3000, 10000],
  stableAfterMs = 60000,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
}) {
  let child = null
  let restartTimer = null
  let stableTimer = null
  let restartIndex = 0
  let stopping = false

  function resetFailures() {
    restartIndex = 0
  }

  function clearStableTimer() {
    if (stableTimer !== null) cancelSchedule(stableTimer)
    stableTimer = null
  }

  function logStream(stream, source) {
    stream?.setEncoding?.('utf8')
    stream?.on('data', (text) => writeLog({ name, stream: source, text: String(text) }))
  }

  function launch() {
    stopping = false
    onStateChange(restartIndex === 0 ? 'starting' : 'restarting')
    child = spawnProcess()
    logStream(child.stdout, 'stdout')
    logStream(child.stderr, 'stderr')
    child.once('error', (error) => {
      writeLog({ name, stream: 'error', text: `${error.stack ?? error.message}\n` })
    })
    child.once('exit', (code, signal) => {
      clearStableTimer()
      child = null
      writeLog({ name, stream: 'exit', text: `exit code=${code} signal=${signal}\n` })
      if (stopping) {
        onStateChange('stopped')
        return
      }
      const delay = restartDelays[restartIndex]
      if (delay == null) {
        onStateChange('failed')
        return
      }
      restartIndex += 1
      onStateChange('restarting')
      restartTimer = schedule(() => {
        restartTimer = null
        launch()
      }, delay)
    })
    onStateChange('running')
    stableTimer = schedule(() => {
      stableTimer = null
      resetFailures()
    }, stableAfterMs)
    return child
  }

  return {
    start() {
      if (child) return child
      if (restartTimer !== null) cancelSchedule(restartTimer)
      restartTimer = null
      clearStableTimer()
      resetFailures()
      return launch()
    },
    stop() {
      stopping = true
      if (restartTimer !== null) cancelSchedule(restartTimer)
      restartTimer = null
      clearStableTimer()
      if (child && !child.killed) child.kill()
      else onStateChange('stopped')
    },
    resetFailures,
  }
}

module.exports = { createManagedProcess }
