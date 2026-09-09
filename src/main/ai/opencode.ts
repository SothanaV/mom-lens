import { spawn, spawnSync } from 'child_process'
import type { ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { WebContents } from 'electron'
import { CH } from '@shared/ipc'
import type { AiData, AiDone, AiInfo, AiRequest } from '@shared/types'

type Sendable = Pick<WebContents, 'send' | 'isDestroyed'>

/** Minimal shape of an `opencode run --format json` JSON-lines event. */
interface OcEvent {
  type?: string
  sessionID?: string
  part?: { type?: string; text?: string; cost?: number; reason?: string }
}

interface RunHandle {
  child?: ChildProcess
  sender: Sendable
  doneSent: boolean
  stopped: boolean
}

const STDERR_TAIL = 2000

const runs = new Map<string, RunHandle>()

function send(sender: Sendable, channel: string, payload: unknown): void {
  try {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  } catch {
    /* window may be gone */
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Resolve the opencode binary: env override, else `which opencode`, else bare name. */
export function resolveBinary(): string {
  const fromEnv = process.env.SOLENS_OPENCODE_BIN
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  try {
    const which = spawnSync('which', ['opencode'], { encoding: 'utf8' })
    if (which.status === 0) {
      const first = (which.stdout ?? '')
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0)
      if (first) return first
    }
  } catch {
    /* which may be unavailable */
  }
  return 'opencode'
}

export function getInfo(): AiInfo {
  const bin = resolveBinary()
  try {
    const res = spawnSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    if (res.error) {
      return { available: false, path: bin, message: messageOf(res.error) }
    }
    if (res.status !== 0) {
      const tail = (res.stderr ?? '').trim() || `exited with code ${res.status}`
      return { available: false, path: bin, message: tail }
    }
    const version =
      (res.stdout ?? '')
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? undefined
    return { available: true, path: bin, version }
  } catch (err) {
    return { available: false, path: bin, message: messageOf(err) }
  }
}

export function listModels(): string[] {
  const bin = resolveBinary()
  try {
    const res = spawnSync(bin, ['models'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const seen = new Set<string>()
    const models: string[] = []
    for (const raw of (res.stdout ?? '').split('\n')) {
      const line = raw.trim()
      if (!line || seen.has(line)) continue
      seen.add(line)
      models.push(line)
    }
    return models
  } catch {
    return []
  }
}

function finish(id: string, handle: RunHandle, done: AiDone): void {
  if (handle.doneSent) return
  handle.doneSent = true
  runs.delete(id)
  send(handle.sender, CH.onAiDone, done)
}

export function start(id: string, req: AiRequest, sender: Sendable): boolean {
  try {
    const bin = resolveBinary()
    // Prompt is passed as an argv element; never interpolated into a shell.
    const args = ['run', req.prompt, '--format', 'json']
    if (req.model) args.push('--model', req.model)
    if (req.agent) args.push('--agent', req.agent)
    if (req.session) args.push('--session', req.session)

    const cwd = req.cwd && req.cwd.trim() ? req.cwd : path.join(os.tmpdir(), 'momlens-ai')
    try {
      fs.mkdirSync(cwd, { recursive: true })
    } catch {
      /* fall back to whatever cwd spawn can use */
    }

    const handle: RunHandle = { sender, doneSent: false, stopped: false }
    runs.set(id, handle)

    // stdin is 'ignore': `opencode run` reads piped stdin when it is an open pipe and
    // would otherwise block waiting for EOF. We always pass the prompt as an argv element.
    const child = spawn(bin, args, { cwd, env: process.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    handle.child = child

    let stdoutBuf = ''
    let stderrTail = ''
    let sessionID: string | undefined
    let cost: number | undefined

    const handleLine = (raw: string): void => {
      const line = raw.trim()
      if (!line) return
      let evt: OcEvent
      try {
        evt = JSON.parse(line) as OcEvent
      } catch {
        return
      }
      if (typeof evt.sessionID === 'string') sessionID = evt.sessionID
      if (evt.type === 'text') {
        const text = evt.part?.text
        if (typeof text === 'string' && !handle.doneSent) {
          send(sender, CH.onAiData, { id, chunk: text } satisfies AiData)
        }
      } else if (evt.type === 'step_finish') {
        const c = evt.part?.cost
        if (typeof c === 'number') cost = c
      }
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdoutBuf += chunk
      let idx: number
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx)
        stdoutBuf = stdoutBuf.slice(idx + 1)
        handleLine(line)
      }
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL)
    })

    child.on('error', (err) => {
      finish(id, handle, { id, sessionID, cost, error: messageOf(err) })
    })

    child.on('close', (code) => {
      if (stdoutBuf.trim()) handleLine(stdoutBuf)
      stdoutBuf = ''
      let error: string | undefined
      if (!handle.stopped && code !== 0) {
        const tail = stderrTail.trim()
        error = `opencode exited ${code}${tail ? ` ${tail}` : ''}`
      }
      finish(id, handle, { id, sessionID, cost, error })
    })

    return true
  } catch (err) {
    runs.delete(id)
    send(sender, CH.onAiDone, { id, error: messageOf(err) } satisfies AiDone)
    return false
  }
}

export function stop(id: string): void {
  const handle = runs.get(id)
  if (!handle) return
  handle.stopped = true
  runs.delete(id)
  try {
    handle.child?.kill()
  } catch {
    /* already gone */
  }
}
