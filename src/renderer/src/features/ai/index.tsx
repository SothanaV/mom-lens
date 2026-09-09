import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AiInfo } from '@shared/types'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

export default function AIPage(): React.ReactElement {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const ai = api?.ai
  const events = api?.events
  const hasApi = !!ai && !!events

  const [info, setInfo] = useState<AiInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])

  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState('')
  const [agent, setAgent] = useState('')
  const [streaming, setStreaming] = useState(false)

  const streamIdRef = useRef<string | null>(null)
  const sessionRef = useRef<string | undefined>(undefined)
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const askAppliedRef = useRef(false)

  const [searchParams] = useSearchParams()

  // Probe opencode availability on mount.
  useEffect(() => {
    if (!ai) return
    let alive = true
    ai
      .info()
      .then((res) => {
        if (alive) setInfo(res)
      })
      .catch((err: unknown) => {
        if (alive) {
          setInfo({ available: false })
          setInfoError(err instanceof Error ? err.message : String(err))
        }
      })
    ai
      .listModels()
      .then((m) => {
        if (alive) setModels(m)
      })
      .catch(() => {
        /* model list is best-effort */
      })
    return () => {
      alive = false
    }
  }, [ai])

  // Subscribe to stream events ONCE; route to the current run by id (via ref).
  useEffect(() => {
    if (!events) return
    const offData = events.onAiData((e) => {
      if (e.id !== streamIdRef.current) return
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (last.role !== 'assistant') return prev
        const next = prev.slice(0, -1)
        next.push({ ...last, content: last.content + e.chunk })
        return next
      })
    })
    const offDone = events.onAiDone((e) => {
      if (e.id !== streamIdRef.current) return
      if (e.sessionID) sessionRef.current = e.sessionID
      streamIdRef.current = null
      setStreaming(false)
      if (e.error) {
        setMessages((prev) => {
          if (prev.length === 0) return prev
          const last = prev[prev.length - 1]
          const note = `\n\n[error] ${e.error}`
          const next = prev.slice(0, -1)
          next.push({ ...last, content: `${last.content}${note}` })
          return next
        })
      }
    })
    return () => {
      offData()
      offDone()
    }
  }, [events])

  // Auto-scroll the transcript to the bottom as it grows.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Prefill the composer from ?ask= once (decoded), focus, never auto-send.
  useEffect(() => {
    if (askAppliedRef.current) return
    askAppliedRef.current = true
    const ask = searchParams.get('ask')
    if (ask) {
      setInput(ask)
      const el = inputRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const disabledSend = !hasApi || streaming || (!!info && info.available === false)

  const send = useCallback(async (): Promise<void> => {
    if (!ai) return
    const prompt = input.trim()
    if (!prompt || streaming) return
    const id = crypto.randomUUID()
    streamIdRef.current = id
    setStreaming(true)
    setMessages((prev) => [...prev, { role: 'user', content: prompt }, { role: 'assistant', content: '' }])
    setInput('')
    try {
      await ai.start(id, {
        prompt,
        model: model.trim() || undefined,
        agent: agent.trim() || undefined,
        session: sessionRef.current || undefined
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      streamIdRef.current = null
      setStreaming(false)
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const next = prev.slice(0, -1)
        const last = prev[prev.length - 1]
        next.push({ ...last, content: `${last.content}\n\n[error] ${message}` })
        return next
      })
    }
  }, [ai, input, streaming, model, agent])

  const stop = useCallback((): void => {
    const id = streamIdRef.current
    if (id && ai) ai.stop(id).catch(() => {})
  }, [ai])

  const clear = useCallback((): void => {
    const id = streamIdRef.current
    if (id && ai) ai.stop(id).catch(() => {})
    streamIdRef.current = null
    sessionRef.current = undefined
    setStreaming(false)
    setMessages([])
  }, [ai])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void send()
      }
    },
    [send]
  )

  if (!hasApi) {
    return (
      <div style={pageStyle}>
        <div className="panel" style={emptyStyle}>
          AI unavailable: bridge (window.api) not present. mom-lens must run inside the Electron app.
        </div>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <div
        style={{
          ...bannerStyle,
          borderColor: info?.available ? 'rgba(87,185,138,0.4)' : 'rgba(224,169,78,0.4)'
        }}
      >
        <span
          className="chip"
          style={{
            color: info?.available ? 'var(--success)' : 'var(--warning)',
            borderColor: info?.available ? 'rgba(87,185,138,0.5)' : 'rgba(224,169,78,0.5)'
          }}
        >
          {info == null ? 'checking…' : info.available ? 'opencode ready' : 'opencode not found'}
        </span>
        {info?.available && info.version ? (
          <span className="mono" style={{ color: 'var(--text-dim)' }}>
            v{info.version}
          </span>
        ) : null}
        {info?.available && info.path ? (
          <span className="mono faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {info.path}
          </span>
        ) : null}
        {info && !info.available && (
          <span style={{ color: 'var(--text-dim)', flex: 1, minWidth: 0 }}>
            Install the <span className="mono">opencode</span> CLI or set <span className="mono">SOLENS_OPENCODE_BIN</span>
            {info.message ? ` — ${info.message}` : ''}
            {infoError ? ` — ${infoError}` : ''}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          {sessionRef.current ? <span className="chip accent">session</span> : null}
        </span>
      </div>

      <div ref={listRef} style={transcriptStyle}>
        {messages.length === 0 ? (
          <div style={emptyStyle}>
            Ask mom-lens anything about your clusters. Answers stream from your local{' '}
            <span className="mono">opencode</span> runner.
          </div>
        ) : (
          messages.map((m, i) => <MessageRow key={i} msg={m} streaming={streaming && i === messages.length - 1} />)
        )}
      </div>

      <div style={composerStyle}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <input
            list="momlens-ai-models"
            style={fieldStyle}
            placeholder="provider/model (default)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            spellCheck={false}
          />
          <datalist id="momlens-ai-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <input
            style={fieldStyle}
            placeholder="agent (optional)"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            spellCheck={false}
          />
          {sessionRef.current ? (
            <span className="chip mono" title={sessionRef.current}>
              multi-turn
            </span>
          ) : null}
        </div>
        <textarea
          ref={inputRef}
          style={textareaStyle}
          placeholder={info && !info.available ? 'opencode is not available' : 'Ask about your cluster… (Enter to send, Shift+Enter for newline)'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!!info && info.available === false}
          rows={3}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <button
            className="btn primary"
            onClick={() => void send()}
            disabled={disabledSend || !input.trim()}
          >
            {streaming ? 'Streaming…' : 'Send'}
          </button>
          {streaming ? (
            <button className="btn danger" onClick={stop}>
              Stop
            </button>
          ) : null}
          <button className="btn" onClick={clear} disabled={messages.length === 0 && !streaming}>
            Clear
          </button>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
            model falls back to the opencode default
          </span>
        </div>
      </div>
    </div>
  )
}

function MessageRow({ msg, streaming }: { msg: Msg; streaming: boolean }): React.ReactElement {
  const isUser = msg.role === 'user'
  return (
    <div
      style={{
        borderLeft: `2px solid ${isUser ? 'var(--accent)' : 'var(--success)'}`,
        padding: '2px 0 2px 12px',
        marginBottom: 14
      }}
    >
      <div style={{ color: 'var(--text-faint)', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {isUser ? 'You' : 'mom-lens'}
      </div>
      <div
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: 'var(--text)',
          fontSize: 13,
          lineHeight: 1.55,
          minHeight: msg.content ? undefined : 18
        }}
      >
        {msg.content}
        {!isUser && streaming && !msg.content ? <span className="spin">…</span> : null}
      </div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  boxSizing: 'border-box',
  padding: 16,
  gap: 12
}

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flex: '0 0 auto',
  padding: '8px 12px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-elev)',
  fontSize: 12,
  minWidth: 0
}

const transcriptStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '4px 6px 12px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-deep)'
}

const composerStyle: React.CSSProperties = {
  flex: '0 0 auto',
  padding: 12,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-elev)'
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  resize: 'vertical',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.5,
  outline: 'none',
  boxSizing: 'border-box'
}

const fieldStyle: React.CSSProperties = {
  flex: '1 1 160px',
  minWidth: 140,
  padding: '4px 9px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 12,
  outline: 'none'
}

const emptyStyle: React.CSSProperties = {
  color: 'var(--text-dim)',
  padding: 24,
  textAlign: 'center'
}
