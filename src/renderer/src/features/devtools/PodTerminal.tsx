import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { usePodContainers } from './usePodContainers'
import { barStyle, panelStyle, palette, selectStyle } from './theme'

interface PodTerminalProps {
  namespace: string
  podName: string
}

interface CommandOption {
  label: string
  command: string[]
}

const COMMAND_OPTIONS: CommandOption[] = [
  { label: '/bin/sh -i', command: ['/bin/sh', '-i'] },
  { label: '/bin/bash -i', command: ['/bin/bash', '-i'] },
  { label: '/bin/sh', command: ['/bin/sh'] }
]
const DEFAULT_COMMAND = COMMAND_OPTIONS[0].label

const termTheme: ITheme = {
  background: '#1b1d20',
  foreground: '#dfe1e5',
  cursor: '#3d90ce',
  black: '#1b1d20',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#3d90ce',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#dfe1e5',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff'
}

export function PodTerminal({ namespace, podName }: PodTerminalProps) {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const hostRef = useRef<HTMLDivElement | null>(null)
  const { containers, loaded } = usePodContainers(api, namespace, podName)
  const [container, setContainer] = useState<string | null>(null)
  const [commandKey, setCommandKey] = useState<string>(DEFAULT_COMMAND)

  const activeContainer = container ?? containers[0] ?? null

  // One terminal + exec session per (container, command): changing either tears
  // down the old session (execStop + dispose) and starts a fresh one with a new id.
  useEffect(() => {
    if (!api || !loaded) return
    const host = hostRef.current
    if (!host) return

    const command = (COMMAND_OPTIONS.find((o) => o.label === commandKey) ?? COMMAND_OPTIONS[0]).command

    const term = new Terminal({
      fontFamily: '"DejaVu Sans Mono","SFMono-Regular",Menlo,Consolas,"Liberation Mono",monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: termTheme
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)

    const id = crypto.randomUUID()
    let stopped = false

    const sendResize = (): void => {
      if (stopped) return
      const { cols, rows } = term
      if (cols > 0 && rows > 0) api.k8s.execResize(id, cols, rows).catch(() => {})
    }

    try {
      fit.fit()
    } catch {
      /* container not sized yet; ResizeObserver will retry */
    }

    const offData = api.events.onExecData((e) => {
      if (e.id !== id) return
      term.write(e.chunk)
    })
    const offExit = api.events.onExecExit((e) => {
      if (e.id !== id) return
      term.write(`\r\n\x1b[90m[process exited (${e.code})]\x1b[0m\r\n`)
    })
    const dataDisp = term.onData((data) => {
      api.k8s.execWrite(id, data).catch(() => {})
    })
    const resizeDisp = term.onResize(() => sendResize())

    api.k8s
      .execStart(id, {
        namespace,
        podName,
        container: activeContainer ?? undefined,
        command,
        tty: true
      })
      .catch(() => term.write('\r\n\x1b[31m[failed to start exec session]\x1b[0m\r\n'))

    term.focus()

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* ignore while hidden */
      }
    })
    ro.observe(host)

    // Nudge the pty with the initial size once it is ready.
    const raf = requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
      sendResize()
    })

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      offData()
      offExit()
      dataDisp.dispose()
      resizeDisp.dispose()
      api.k8s.execStop(id).catch(() => {})
      fit.dispose()
      term.dispose()
    }
  }, [api, loaded, namespace, podName, activeContainer, commandKey])

  if (!api) {
    return (
      <div className="panel" style={panelStyle}>
        <div style={{ padding: 12, color: palette.textDim }} className="mono">
          Terminal unavailable: bridge (window.api) not present.
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

        <select
          className="mono"
          style={selectStyle}
          title="command"
          value={commandKey}
          onChange={(e) => setCommandKey(e.target.value)}
        >
          {COMMAND_OPTIONS.map((o) => (
            <option key={o.label} value={o.label}>{o.label}</option>
          ))}
        </select>
      </div>

      <div
        ref={hostRef}
        className="mono"
        style={{
          height: 300,
          width: '100%',
          boxSizing: 'border-box',
          padding: '6px 8px',
          background: palette.editorBg,
          overflow: 'hidden'
        }}
      />
    </div>
  )
}
