import { useCallback, useEffect, useRef, useState } from 'react'

export interface LogBuffer {
  /** Completed lines plus an optional trailing (not-yet-newline-terminated) line. */
  lines: string[]
  /** Number of completed lines currently held (after cap). */
  count: number
  append: (chunk: string) => void
  clear: () => void
  /** Full buffer as a single string (for copy / download). */
  getText: () => string
}

/**
 * Accumulates streamed log chunks into a capped, render-throttled list of lines.
 * Chunks may split mid-line, so the trailing partial line is carried across calls.
 * Commits are coalesced to one per animation frame to survive chatty `follow` streams.
 */
export function useLogBuffer(maxLines = 5000): LogBuffer {
  const [lines, setLines] = useState<string[]>([])
  const [count, setCount] = useState(0)
  const bufRef = useRef<string[]>([])
  const partialRef = useRef('')
  const rafRef = useRef<number | null>(null)

  const flush = useCallback((): void => {
    rafRef.current = null
    const arr = bufRef.current
    const partial = partialRef.current
    setLines(partial ? arr.concat(partial) : arr.slice())
    setCount(arr.length)
  }, [])

  const schedule = useCallback((): void => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush)
  }, [flush])

  const append = useCallback(
    (chunk: string): void => {
      if (!chunk) return
      const combined = partialRef.current + chunk
      const parts = combined.split('\n')
      partialRef.current = parts.pop() ?? ''
      const buf = bufRef.current
      for (let i = 0; i < parts.length; i++) buf.push(parts[i])
      if (buf.length > maxLines) buf.splice(0, buf.length - maxLines)
      schedule()
    },
    [maxLines, schedule]
  )

  const clear = useCallback((): void => {
    bufRef.current = []
    partialRef.current = ''
    setLines([])
    setCount(0)
  }, [])

  const getText = useCallback((): string => {
    const partial = partialRef.current
    return partial ? bufRef.current.concat(partial).join('\n') : bufRef.current.join('\n')
  }, [])

  useEffect(() => {
    return (): void => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  return { lines, count, append, clear, getText }
}
