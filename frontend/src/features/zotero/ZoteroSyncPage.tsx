import { useEffect, useState } from 'react'
import { requestJson } from '../../contracts/api-client'
import './ZoteroSyncPage.css'

type Collection = { key: string; name: string; directItemCount: number; childCollectionCount: number }
type Collections = { items: Collection[]; syncSelection: { collectionKeys: string[]; includeSubcollections: boolean } | null }
type Result = { foundCount?: number; importableCount?: number; createdCount?: number; updatedCount?: number; unchangedCount?: number; withPdfCount?: number; missingPdfCount?: number }

export default function ZoteroSyncPage() {
  const [data, setData] = useState<Collections | null>(null); const [selected, setSelected] = useState(''); const [result, setResult] = useState<Result | null>(null); const [message, setMessage] = useState('')
  const load = async () => { try { const value = await requestJson<Collections>('/api/v1/zotero/collections'); setData(value); setSelected(value.syncSelection?.collectionKeys[0] ?? value.items[0]?.key ?? '') } catch (e) { setMessage(e instanceof Error ? e.message : 'Zotero 连接失败。') } }
  useEffect(() => { void load() }, [])
  async function preview() { setResult(await requestJson<Result>('/api/v1/zotero/import-preview', { method: 'POST', body: JSON.stringify({ mode: 'collections', collectionKeys: [selected], includeSubcollections: false }) })) }
  async function sync() { setResult(await requestJson<Result>('/api/v1/zotero/import', { method: 'POST', body: JSON.stringify({ mode: 'collections', collectionKeys: [selected], includeSubcollections: false, saveAsSyncScope: true }) })); setMessage('同步完成。') }
  async function syncSaved() { setResult(await requestJson<Result>('/api/v1/zotero/sync', { method: 'POST', body: '{}' })); setMessage('已按保存的同步范围完成同步。') }
  return <section className="zotero-page"><header><p>ZOTERO WORKSPACE</p><h1>Zotero 同步</h1><span>首次选择文件夹并保存，之后可按已保存范围同步。</span></header>{message && <p role="status">{message}</p>}<label>文件夹<select value={selected} onChange={e => setSelected(e.target.value)}>{data?.items.map(item => <option key={item.key} value={item.key}>{item.name}（{item.directItemCount} 篇）</option>)}</select></label><div className="zotero-actions"><button type="button" disabled={!selected} onClick={() => void preview()}>预览</button><button type="button" disabled={!selected} onClick={() => void sync()}>首次导入并保存范围</button><button type="button" disabled={!data?.syncSelection} onClick={() => void syncSaved()}>按已保存范围同步</button><button type="button" onClick={() => void load()}>刷新连接</button></div>{result && <div className="zotero-result"><strong>最近结果</strong><span>发现 {result.foundCount ?? 0} 篇</span><span>新增 {result.createdCount ?? 0} 篇</span><span>更新 {result.updatedCount ?? 0} 篇</span><span>未变化 {result.unchangedCount ?? 0} 篇</span><span>含 PDF {result.withPdfCount ?? 0} 篇</span><span>缺 PDF {result.missingPdfCount ?? 0} 篇</span></div>}</section>
}
