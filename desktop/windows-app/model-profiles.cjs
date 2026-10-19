const { loadSecureModelConfig, saveSecureModelConfig, clearSecureModelConfig } = require('./secure-model-config.cjs')

function loadModelProfiles(filePath, safeStorage) {
  const saved = loadSecureModelConfig(filePath, safeStorage)
  if (!saved) return { activeId: null, items: [] }
  if (Array.isArray(saved.items)) return saved
  return {
    activeId: 'legacy',
    items: [{ id: 'legacy', name: `${saved.provider} · ${saved.model}`, config: saved }],
  }
}

function saveModelProfiles(filePath, profiles, safeStorage) {
  if (profiles.items.length) saveSecureModelConfig(filePath, profiles, safeStorage)
  else clearSecureModelConfig(filePath)
}

function publicModelProfiles(profiles) {
  return {
    activeId: profiles.activeId,
    items: profiles.items.map(({ id, name, config }) => ({
      id, name, provider: config.provider, baseUrl: config.baseUrl, model: config.model,
    })),
  }
}

module.exports = { loadModelProfiles, saveModelProfiles, publicModelProfiles }
