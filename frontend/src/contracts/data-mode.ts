export type DataMode = 'mock' | 'api'

export function resolveDataMode(value: string | undefined): DataMode {
  return value === 'api' ? 'api' : 'mock'
}

export function getDataMode(): DataMode {
  return resolveDataMode(import.meta.env.VITE_DATA_MODE)
}
