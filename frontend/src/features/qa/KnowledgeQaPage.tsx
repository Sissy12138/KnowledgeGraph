import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiClientError, requestJson } from '../../contracts/api-client'
import './KnowledgeQaPage.css'

type QaSource = {
  id: string
  type: string
  paperId: string | null
  title: string
  excerpt: string
  location?: string
  year?: number
  journal?: string
}

type QaResponse = {
  answer: string
  sources: QaSource[]
  model: string | null
}

type QaMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: QaSource[]
  model?: string | null
}

type AskQuestion = (question: string, history: Array<{ role: string; content: string }>) => Promise<QaResponse>

const QUICK_QUESTIONS = [
  '这些论文主要研究了哪些问题？',
  '文献库中常用的研究方法有哪些？',
  '不同论文的主要发现有哪些共同点和差异？',
]

const SOURCE_LABELS: Record<string, string> = {
  paper: '论文概览', evidence: '原文证据', concept: '概念', method: '方法', finding: '发现',
}

async function askLibrary(question: string, history: Array<{ role: string; content: string }>) {
  return requestJson<QaResponse>('/api/v1/qa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history }),
  })
}

function SourceCard({ source, index }: { source: QaSource; index: number }) {
  const content = <>
    <span className="knowledge-qa__source-number">[{index}]</span>
    <span className="knowledge-qa__source-copy">
      <strong>{source.title}</strong>
      <span>{SOURCE_LABELS[source.type] ?? source.type}{source.location ? ` · ${source.location}` : ''}{source.year ? ` · ${source.year}` : ''}</span>
      <small>{source.excerpt}</small>
    </span>
    {source.paperId && <span aria-hidden="true" className="knowledge-qa__source-arrow">→</span>}
  </>

  return source.paperId
    ? <Link className="knowledge-qa__source" to={`/papers/${encodeURIComponent(source.paperId)}`}>{content}</Link>
    : <div className="knowledge-qa__source">{content}</div>
}

export default function KnowledgeQaPage({ askQuestion = askLibrary }: { askQuestion?: AskQuestion }) {
  const [messages, setMessages] = useState<QaMessage[]>([])
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canSubmit = question.trim().length >= 2 && !pending
  const history = useMemo(() => messages.slice(-6).map(({ role, content }) => ({ role, content })), [messages])

  async function submit(nextQuestion = question) {
    const cleaned = nextQuestion.trim()
    if (cleaned.length < 2 || pending) return
    const userMessage: QaMessage = { id: crypto.randomUUID(), role: 'user', content: cleaned }
    setMessages(current => [...current, userMessage])
    setQuestion('')
    setError('')
    setPending(true)
    try {
      const result = await askQuestion(cleaned, history)
      setMessages(current => [...current, {
        id: crypto.randomUUID(), role: 'assistant', content: result.answer,
        sources: result.sources, model: result.model,
      }])
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === 'MODEL_NOT_CONFIGURED') {
        setError('尚未配置可用的大模型 API。请先进入“模型配置”保存并测试连接。')
      } else {
        setError(cause instanceof Error ? cause.message : '问答请求失败，请稍后重试。')
      }
    } finally {
      setPending(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }

  return <section className="knowledge-qa">
    <header className="knowledge-qa__header">
      <div>
        <p className="knowledge-qa__eyebrow">ASK YOUR LIBRARY</p>
        <h1>知识问答</h1>
        <p>只依据已导入并完成分析的论文、研究概览与原文证据回答，关键判断会标注材料编号。</p>
      </div>
      {messages.length > 0 && <button className="knowledge-qa__clear" type="button" onClick={() => { setMessages([]); setError('') }}>清空对话</button>}
    </header>

    <div className="knowledge-qa__conversation" aria-live="polite">
      {messages.length === 0 && <div className="knowledge-qa__welcome">
        <div className="knowledge-qa__mark" aria-hidden="true">问</div>
        <h2>从你的真实文献库开始提问</h2>
        <p>可以归纳研究问题、比较方法与发现，也可以追问某篇论文的证据。回答不会写回或修改知识图谱。</p>
        <div className="knowledge-qa__quick-list">
          {QUICK_QUESTIONS.map(item => <button type="button" key={item} onClick={() => void submit(item)}>{item}<span aria-hidden="true">↗</span></button>)}
        </div>
      </div>}

      {messages.map(message => <article className={`knowledge-qa__message knowledge-qa__message--${message.role}`} key={message.id}>
        <div className="knowledge-qa__avatar" aria-hidden="true">{message.role === 'user' ? '你' : '研'}</div>
        <div className="knowledge-qa__bubble">
          <p>{message.content}</p>
          {message.role === 'assistant' && message.model && <span className="knowledge-qa__model">由 {message.model} 基于本地材料生成</span>}
          {!!message.sources?.length && <details className="knowledge-qa__sources" open>
            <summary>参考材料（{message.sources.length}）</summary>
            <div>{message.sources.map((source, index) => <SourceCard key={`${source.id}-${index}`} source={source} index={index + 1} />)}</div>
          </details>}
        </div>
      </article>)}

      {pending && <div className="knowledge-qa__thinking" role="status"><span /><span /><span /> 正在检索文献并组织回答…</div>}
      {error && <div className="knowledge-qa__error" role="alert">{error} {error.includes('模型配置') && <Link to="/settings/model">前往模型配置</Link>}</div>}
    </div>

    <form className="knowledge-qa__composer" onSubmit={event => { event.preventDefault(); void submit() }}>
      <label htmlFor="knowledge-question">向文献库提问</label>
      <div>
        <textarea
          id="knowledge-question" ref={textareaRef} value={question} maxLength={1000}
          onChange={event => setQuestion(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (canSubmit) void submit()
            }
          }}
          placeholder="例如：这些论文中哪些方法被用于研究认知灵活性？"
          rows={3}
        />
        <button type="submit" disabled={!canSubmit}>{pending ? '回答中…' : '发送问题'}</button>
      </div>
      <small>Enter 发送 · Shift + Enter 换行 · 回答仅供科研整理与核对</small>
    </form>
  </section>
}
