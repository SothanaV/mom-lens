import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

interface NamespaceSelectProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  contextKey: string
}

interface ComboOption {
  value: string
  label: string
}

interface NamespaceSelection {
  all: boolean
  names: string[]
}

const ALL_VALUE = 'all'
const ALL_OPTION: ComboOption = { value: ALL_VALUE, label: 'All namespaces' }

export function parseNamespaceSelection(value: string | null | undefined): NamespaceSelection {
  const raw = (value ?? '').trim()
  if (!raw || raw === ALL_VALUE) return { all: true, names: [] }
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  return names.length ? { all: false, names } : { all: true, names: [] }
}

export function namespaceSummary(value: string | null | undefined): string {
  const { all, names } = parseNamespaceSelection(value)
  if (all) return ALL_OPTION.label
  if (names.length === 1) return names[0]
  return `${names.length} namespaces selected`
}

function serializeSelection(names: string[]): string {
  const unique = [...new Set(names)]
  return unique.length ? unique.sort().join(',') : ALL_VALUE
}

function getApi(): typeof window.api | undefined {
  return typeof window !== 'undefined' ? window.api : undefined
}

let cachedKey: string | null = null
let cachedNames: string[] = []

export default function NamespaceSelect({
  value,
  onChange,
  disabled = false,
  contextKey
}: NamespaceSelectProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [names, setNames] = useState<string[]>(() => (cachedKey === contextKey ? cachedNames : []))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    if (cachedKey === contextKey) {
      setNames(cachedNames)
      return
    }
    cachedKey = null
    cachedNames = []
    setNames([])
  }, [contextKey])

  const load = useCallback(async (): Promise<void> => {
    if (cachedKey === contextKey) {
      setNames(cachedNames)
      return
    }
    const api = getApi()
    if (!api?.k8s?.listNamespaces) {
      setError('Namespace API unavailable')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await api.k8s.listNamespaces()
      if (res.error) {
        setError(res.error.message)
        return
      }
      const list = res.items
        .map((item) => item.metadata?.name)
        .filter((name): name is string => Boolean(name))
        .sort()
      cachedKey = contextKey
      cachedNames = list
      setNames(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [contextKey])

  const openMenu = useCallback((): void => {
    if (disabled) return
    setOpen(true)
    setQuery('')
    setHighlight(0)
    void load()
  }, [disabled, load])

  const closeMenu = useCallback((focusTrigger = true): void => {
    setOpen(false)
    setQuery('')
    if (focusTrigger) triggerRef.current?.focus()
  }, [])

  const selection = useMemo(() => parseNamespaceSelection(value), [value])

  const toggleOption = useCallback(
    (option: ComboOption): void => {
      if (option.value === ALL_VALUE) {
        onChange(ALL_VALUE)
        setOpen(false)
        setQuery('')
        triggerRef.current?.focus()
        return
      }
      const next = new Set(selection.all ? [] : selection.names)
      if (next.has(option.value)) next.delete(option.value)
      else next.add(option.value)
      onChange(serializeSelection([...next]))
    },
    [onChange, selection]
  )

  const isChecked = useCallback(
    (option: ComboOption): boolean =>
      option.value === ALL_VALUE ? selection.all : selection.names.includes(option.value),
    [selection]
  )

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const options = useMemo<ComboOption[]>(() => {
    const q = query.trim().toLowerCase()
    const list = q ? names.filter((name) => name.toLowerCase().includes(q)) : names
    return [ALL_OPTION, ...list.map((name) => ({ value: name, label: name }))]
  }, [names, query])

  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(options.length - 1, 0)))
  }, [options.length])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector(`[data-index="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (disabled) return
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setHighlight((h) => (options.length ? (h + 1) % options.length : 0))
        break
      case 'ArrowUp':
        event.preventDefault()
        setHighlight((h) => (options.length ? (h - 1 + options.length) % options.length : 0))
        break
      case 'Enter': {
        event.preventDefault()
        const option = options[highlight]
        if (option) toggleOption(option)
        break
      }
      case 'Escape':
        event.preventDefault()
        closeMenu()
        break
    }
  }

  return (
    <div ref={rootRef} className={`combo${open ? ' combo--open' : ''}`} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="combo-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={disabled ? 'Cluster-scoped resource' : 'Search & multi-select namespaces'}
        onClick={() => (open ? closeMenu(false) : openMenu())}
      >
        <span className="combo-value">{namespaceSummary(value)}</span>
        <span className="combo-caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="combo-menu" role="dialog" aria-label="Namespace picker">
          <input
            ref={inputRef}
            className="combo-input"
            type="text"
            placeholder="Filter namespaces…"
            aria-label="Filter namespaces"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlight(0)
            }}
          />
          <div
            ref={listRef}
            className="combo-list"
            role="listbox"
            aria-multiselectable={true}
            aria-label="Namespaces"
          >
            {loading && <div className="combo-status">Loading namespaces…</div>}
            {!loading && error && <div className="combo-status combo-status--error">{error}</div>}
            {!loading && !error && options.length <= 1 && (
              <div className="combo-status">
                {query.trim() ? 'No matching namespaces' : 'No namespaces found'}
              </div>
            )}
            {options.map((option, index) => {
              const checked = isChecked(option)
              return (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={checked}
                  data-index={index}
                  className={[
                    'combo-option',
                    index === highlight ? 'combo-option--active' : '',
                    checked ? 'combo-option--selected' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    toggleOption(option)
                  }}
                >
                  <span
                    className={`combo-box${checked ? ' combo-box--on' : ''}`}
                    aria-hidden="true"
                  >
                    {checked ? '✓' : ''}
                  </span>
                  <span className="combo-option-label">{option.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
