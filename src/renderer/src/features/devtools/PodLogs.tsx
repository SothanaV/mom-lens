import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLogBuffer } from './useLogBuffer'
import { usePodContainers } from './usePodContainers'
import {
  activeStyle,
  barStyle,
  checkLabelStyle,
  labelStyle,
  panelStyle,
  palette,
  selectStyle
} from './theme'

interface PodLogsProps {
  namespace: string
  podName: string
}

const STICK_PX = 40

export function PodLogs({ namespace, podName }: PodLogsProps) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const { lines, count, append, clear, getText } = useLogBuffer(5000)
  const { containers, loaded } = usePodContainers(api, namespace, podName)
  const [container, setContainer] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const [wrap, setWrap] = useState(false)
  const [previous, setPrevious] = useState(false)
  const [timestamps, setTimestamps] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const preRef = useRef<HTMLPreElement | null>(null)
  const stickRef = useRef(true)

  // null = default/auto; explicit selection wins once chosen.
  const activeContainer = container ?? containers[0] ?? null

  // (Re)start the log stream whenever the target or any stream option changes.
  useEffect(() => {
    if (!api || !loaded) return
    const id = crypto.randomUUID()
    setError(null)
    clear()
    stickRef.current = true

    const offData = api.events.onLogsData((e) => {
      if (e.id === id) append(e.chunk)
    })
    const offErr = api.events.onLogsError((e) => {
      if (e.id === id) setError(e.message)
    })

    api.k8s
      .logsStart(id, {
        namespace,
        podName,
        container: activeContainer ?? undefined,
        tailLines: 200,
        follow,
        timestamps,
        previous
      })
      .catch((err: unknown) => setError(String(err)))

    return () => {
      offData()
      offErr()
      api.k8s.logsStop(id).catch(() => {})
    }
  }, [api, loaded, namespace, podName, activeContainer, follow, timestamps, previous, append, clear])

  // Log search: build the active matcher; invalid regex stays visible but disables filtering.
  const { matcher, regexError } = useMemo((): { matcher: RegExp | null; regexError: string | null } => {
    const q = query.trim()
    if (!q) return { matcher: null, regexError: null }
    if (regex) {
      try {
        return { matcher: new RegExp(q, caseSensitive ? 'g' : 'gi'), regexError: null }
      } catch (err) {
        return { matcher: null, regexError: err instanceof Error ? err.message : String(err) }
      }
    }
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return { matcher: new RegExp(escaped, caseSensitive ? 'g' : 'gi'), regexError: null }
  }, [query, caseSensitive, regex])

  const visibleLines = useMemo((): string[] => {
    if (!matcher) return lines
    matcher.lastIndex = 0
    return lines.filter((line) => {
      matcher.lastIndex = 0
      return matcher.test(line)
    })
  }, [lines, matcher])

  useEffect(() => {
    const el = preRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [visibleLines])

  const onScroll = useCallback((): void => {
    const el = preRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
  }, [])

  const onClear = useCallback((): void => {
    clear()
    setError(null)
    stickRef.current = true
  }, [clear])

  const onCopy = useCallback((): void => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(getText()).catch(() => {})
    }
  }, [getText])

  const onDownload = useCallback((): void => {
    try {
      const url = URL.createObjectURL(new Blob([getText()], { type: 'text/plain' }))
      const a = document.createElement('a')
      a.href = url
      const suffix = activeContainer ? `_${activeContainer}` : ''
      a.download = `${namespace}_${podName}${suffix}.log`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }, [getText, namespace, podName, activeContainer])

  if (!api) {
    return (
      <div className="panel" style={panelStyle}>
        <div style={{ padding: 12, color: palette.textDim }} className="mono">
          Logs unavailable: bridge (window.api) not present.
        </div>
      </div>
    )
  }

  return (
    <div className="panel" style={panelStyle}>
      <div style={{ ...barStyle, flexWrap: 'wrap', rowGap: 6 }}>
        <span className="mono" style={{ color: palette.text }}>{podName}</span>
        <span className="chip">{namespace}</span>

        {containers.length > 0 ? (
          <select
            className="mono"
            style={selectStyle}
            title="container"
            value={activeContainer ?? ''}
            onChange={(e) => setContainer(e.target.value || null)}
          >
            {containers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        ) : (
          <select className="mono" style={selectStyle} title="container" value="" disabled>
            <option value="">default container</option>
          </select>
        )}

        <label style={checkLabelStyle}>
          <input type="checkbox" checked={previous} onChange={() => setPrevious((p) => !p)} />
          Previous
        </label>
        <label style={checkLabelStyle}>
          <input type="checkbox" checked={timestamps} onChange={() => setTimestamps((t) => !t)} />
          Timestamps
        </label>

        <input
          className="mono"
          type="search"
          placeholder="Search logs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ ...selectStyle, width: 180, paddingLeft: 6 }}
          title="Filter log lines by substring or regex"
        />
        <button
          className="btn"
          type="button"
          style={activeStyle(caseSensitive)}
          onClick={() => setCaseSensitive((v) => !v)}
          title="Match case"
        >
          Aa
        </button>
        <button
          className="btn"
          type="button"
          style={activeStyle(regex)}
          onClick={() => setRegex((v) => !v)}
          title="Regular expression"
        >
          .*
        </button>
        {query.trim() && (
          <button className="btn" type="button" onClick={() => setQuery('')} title="Clear search">
            ×
          </button>
        )}

        <button className="btn" style={activeStyle(follow)} onClick={() => setFollow((f) => !f)}>
          {follow ? 'Following' : 'Paused'}
        </button>
        <button className="btn" style={activeStyle(wrap)} onClick={() => setWrap((w) => !w)}>
          Wrap
        </button>
        <button className="btn" onClick={onClear}>Clear</button>
        <button className="btn" onClick={onCopy}>Copy</button>
        <button className="btn" onClick={onDownload}>Download</button>
        <span className="mono" style={{ ...labelStyle, marginLeft: 'auto' }}>
          {matcher ? `${visibleLines.length} / ${count}` : count} lines
        </span>
      </div>

      {regexError ? (
        <div
          className="mono"
          style={{
            padding: '4px 10px',
            borderBottom: `1px solid ${palette.border}`,
            color: '#e5a04c',
            background: 'rgba(229,160,76,0.08)',
            fontSize: 12
          }}
        >
          Invalid regex — search disabled: {regexError}
        </div>
      ) : null}

      {error ? (
        <div
          className="mono"
          style={{
            padding: '6px 10px',
            borderBottom: `1px solid ${palette.border}`,
            color: '#e06c75',
            background: 'rgba(224,108,117,0.08)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            fontSize: 12
          }}
        >
          {error}
        </div>
      ) : null}

      <pre
        ref={preRef}
        onScroll={onScroll}
        className="mono"
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          margin: 0,
          padding: '8px 10px',
          overflow: 'auto',
          background: palette.editorBg,
          color: palette.text,
          fontSize: 12,
          lineHeight: 1.45,
          whiteSpace: wrap ? 'pre-wrap' : 'pre',
          overflowX: wrap ? 'hidden' : 'auto',
          wordBreak: wrap ? 'break-all' : 'normal'
        }}
      >
        {visibleLines.length > 0
          ? visibleLines.join('\n')
          : error
            ? ''
            : matcher && lines.length > 0
              ? `No lines match “${query.trim()}”.`
              : `No log output from ${activeContainer ?? podName}${previous ? ' (previous)' : ''}.`}
      </pre>
    </div>
  )
}
