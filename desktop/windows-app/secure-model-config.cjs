const fs = require('fs')
const path = require('path')

function loadSecureModelConfig(filePath, safeStorage) {
  if (!fs.existsSync(filePath) || !safeStorage.isEncryptionAvailable()) return null
  const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath)))
  return value && typeof value === 'object' ? value : null
}

function saveSecureModelConfig(filePath, value, safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前 Windows 加密存储不可用，未保存 API Key。')
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, safeStorage.encryptString(JSON.stringify(value)))
}

function clearSecureModelConfig(filePath) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

module.exports = { loadSecureModelConfig, saveSecureModelConfig, clearSecureModelConfig }
