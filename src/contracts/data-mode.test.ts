import { describe, expect, it } from 'vitest'
import { resolveDataMode } from './data-mode'

describe('resolveDataMode', () => {
  it('defaults to mock mode and accepts VITE_DATA_MODE=api', () => {
    expect(resolveDataMode(undefined)).toBe('mock')
    expect(resolveDataMode('api')).toBe('api')
  })
})
