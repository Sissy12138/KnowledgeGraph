import { useEffect, useMemo, useState } from 'react'
import { requestJson } from '../../contracts/api-client'
import './ModelSettingsPage.css'

type Status = { configured: boolean; provider: string | null; baseUrl: string | null; model: string | null }
type ProviderOption = { id: string; label: string; baseUrl: string; models: string[] }
type ProviderResponse = { items: ProviderOption[] }

export default function ModelSettingsPage() {
  const [status, setStatus] = useState<Status>({ configured: false, provider: null, baseUrl: null, model: null })
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState('')
  const selectedProvider = useMemo(() => providers.find(item => item.id === providerId), [providerId, providers])

  useEffect(() => {
    void Promise.all([requestJson<Status>('/api/v1/model-config'), requestJson<ProviderResponse>('/api/v1/model-providers')])
      .then(([nextStatus, response]) => {
        setStatus(nextStatus)
        setProviders(response.items)
        const initial = response.items.find(item => item.id === nextStatus.provider) ?? response.items[0]
        if (initial) {
          setProviderId(initial.id)
          setModel(nextStatus.provider === initial.id && initial.models.includes(nextStatus.model ?? '') ? nextStatus.model ?? initial.models[0] : initial.models[0])
        }
      })
      .catch(() => setMessage('无法连接本地后端。请确认研知图已经启动。'))
  }, [])

  function selectProvider(nextProviderId: string) {
    const next = providers.find(item => item.id === nextProviderId)
    if (!next) return
    setProviderId(next.id)
    setModel(next.models[0] ?? '')
    setMessage('')
  }

  async function save() {
    if (!selectedProvider) return
    try {
      const next = await requestJson<Status>('/api/v1/model-config', {
        method: 'POST',
        body: JSON.stringify({ provider: selectedProvider.id, baseUrl: selectedProvider.baseUrl, model, apiKey }),
      })
      setStatus(next)
      setApiKey('')
      setMessage('配置已保存到本地内存。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。')
    }
  }

  async function clear() {
    const next = await requestJson<Status>('/api/v1/model-config', { method: 'DELETE' })
    setStatus(next)
    setMessage('配置已清除。')
  }

  async function test() {
    try {
      const result = await requestJson<{ latencyMs: number; model: string }>('/api/v1/model-config/test', { method: 'POST', body: '{}' })
      setMessage(`连接成功：${result.model}，耗时 ${result.latencyMs} ms。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接测试失败。')
    }
  }

  return <section className="model-settings">
    <p>LOCAL MODEL</p>
    <h1>模型 API 配置</h1>
    <p>内置主流大模型服务商。选择供应商和模型后，只需填写自己的 API key；key 仅保存在本机后端内存，重启后自动清除。</p>
    <label>供应商
      <select aria-label="供应商" value={providerId} onChange={event => selectProvider(event.target.value)} disabled={!providers.length}>
        {providers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
    <label>兼容 API 地址
      <select aria-label="兼容 API 地址" value={selectedProvider?.baseUrl ?? ''} disabled>
        {selectedProvider && <option value={selectedProvider.baseUrl}>{selectedProvider.baseUrl}</option>}
      </select>
    </label>
    <label>模型
      <select aria-label="模型" value={model} onChange={event => setModel(event.target.value)} disabled={!selectedProvider}>
        {selectedProvider?.models.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
    <label>API key
      <input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" placeholder="粘贴所选服务商的 API key" />
    </label>
    <div>
      <button type="button" onClick={() => void save()} disabled={!apiKey || !selectedProvider || !model}>保存配置</button>
      <button type="button" onClick={() => void test()} disabled={!status.configured}>测试连接</button>
      <button type="button" onClick={() => void clear()}>清除配置</button>
    </div>
    <p role="status">当前状态：{status.configured ? `已配置 ${status.provider} / ${status.model}` : '未配置'}{message && ` · ${message}`}</p>
  </section>
}
