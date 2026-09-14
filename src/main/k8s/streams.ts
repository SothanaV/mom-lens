import * as https from 'https'
import type { ClientRequest } from 'http'
import type { RequestOptions } from 'https'
import { PassThrough } from 'stream'
import type { WebContents } from 'electron'
import { Exec, Watch } from '@kubernetes/client-node'
import { CH } from '@shared/ipc'
import type { ExecRequest, ListRequest, LogRequest, ResourceEvent } from '@shared/types'
import { getKubeConfig } from './kubeconfig'
import { messageOf } from './errors'

type Sendable = Pick<WebContents, 'send' | 'isDestroyed'>

function send(sender: Sendable, channel: string, payload: unknown): void {
  try {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  } catch {
    /* window may be gone */
  }
}

// ---------------------------------------------------------------- watch

interface WatchHandle {
  req?: { abort?: () => void; close?: () => void; destroy?: () => void }
}

const watches = new Map<string, WatchHandle>()

export async function watchStart(id: string, req: ListRequest, sender: Sendable): Promise<boolean> {
  try {
    const kc = getKubeConfig()
    const scope = req.scope
    const prefix = scope.group === '' ? '/api/v1' : `/apis/${scope.group}/${scope.version}`
    const namespacedPath =
      scope.namespaced && req.namespace && !req.allNamespaces
        ? `${prefix}/namespaces/${encodeURIComponent(req.namespace)}/${scope.resource}`
        : null
    const path = namespacedPath ?? `${prefix}/${scope.resource}`

    const handle: WatchHandle = {}
    watches.set(id, handle)

    new Watch(kc).watch(
      path,
      {},
      (type: string, obj: any) => {
        send(sender, CH.onResourceEvent, {
          id,
          type: type as ResourceEvent['type'],
          object: obj
        } satisfies ResourceEvent)
      },
      (err: any) => {
        watches.delete(id)
        if (err) {
          send(sender, CH.onResourceEvent, {
            id,
            type: 'ERROR',
            object: { message: messageOf(err) }
          } satisfies ResourceEvent)
        }
      }
    )
      .then((requestResult: any) => {
        handle.req = requestResult
        if (!watches.has(id)) {
          // stopped before the request materialized
          try {
            requestResult?.abort?.()
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {
        watches.delete(id)
      })
    return true
  } catch {
    return false
  }
}

export function watchStop(id: string): boolean {
  const handle = watches.get(id)
  if (!handle) return false
  watches.delete(id)
  try {
    handle.req?.abort?.()
    ;(handle.req as any)?.close?.()
    ;(handle.req as any)?.destroy?.()
  } catch {
    /* already closed */
  }
  return true
}

// ---------------------------------------------------------------- logs

const logRequests = new Map<string, ClientRequest>()

/** Best-effort extraction of a Kubernetes Status message from a log error body. */
function logStatusMessage(status: number, body: string): string {
  const trimmed = body.trim()
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as { message?: string; reason?: string }
      const msg = parsed.message || parsed.reason
      if (msg) return msg
    } catch {
      /* not JSON; fall through */
    }
    return trimmed.slice(0, 400)
  }
  return `Log request failed (HTTP ${status})`
}

export async function logsStart(id: string, req: LogRequest, sender: Sendable): Promise<boolean> {
  try {
    const kc = getKubeConfig()
    const cluster = kc.getCurrentCluster()
    if (!cluster) {
      send(sender, CH.onLogsError, { id, message: 'No currently active cluster' })
      return false
    }
    const url = new URL(cluster.server)
    const qs = new URLSearchParams()
    if (req.container) qs.set('container', req.container)
    if (req.tailLines != null) qs.set('tailLines', String(req.tailLines))
    if (req.timestamps) qs.set('timestamps', 'true')
    if (req.previous) qs.set('previous', 'true')
    if (req.follow) qs.set('follow', '1')

    // Preserve the server URL's path prefix (e.g. Rancher's /k8s/clusters/<id>).
    // Other calls (list/watch/exec) keep it by joining onto the full server URL;
    // this raw https request must prepend it explicitly or proxied clusters 403.
    const prefix = url.pathname.replace(/\/+$/, '')
    const opts: RequestOptions = {
      hostname: url.hostname,
      port: url.port ? Number(url.port) : 443,
      method: 'GET',
      path: `${prefix}/api/v1/namespaces/${encodeURIComponent(req.namespace)}/pods/${encodeURIComponent(
        req.podName
      )}/log?${qs.toString()}`
    }
    await kc.applyToHTTPSOptions(opts)

    const request = https.request(opts, (res) => {
      res.setEncoding('utf8')
      const status = res.statusCode ?? 0
      if (status >= 400) {
        // Kubernetes returns a JSON Status body on errors; surface its message
        // instead of silently streaming it as if it were log output.
        let body = ''
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () => {
          logRequests.delete(id)
          send(sender, CH.onLogsError, { id, message: logStatusMessage(status, body) })
        })
        return
      }
      res.on('data', (chunk: string) => {
        send(sender, CH.onLogsData, { id, chunk })
      })
      // A clean 'end' is normal (completed pod, `previous`, or a follow=false tail)
      // and is NOT an error — the renderer keeps the lines it already received.
      res.on('end', () => {
        logRequests.delete(id)
      })
    })
    request.on('error', (err) => {
      logRequests.delete(id)
      send(sender, CH.onLogsError, { id, message: messageOf(err) })
    })
    request.end()
    logRequests.set(id, request)
    return true
  } catch (err) {
    send(sender, CH.onLogsError, { id, message: messageOf(err) })
    return false
  }
}

export function logsStop(id: string): boolean {
  const request = logRequests.get(id)
  if (!request) return false
  logRequests.delete(id)
  try {
    request.destroy()
  } catch {
    /* already destroyed */
  }
  return true
}

// ---------------------------------------------------------------- exec

interface ExecHandle {
  id: string
  ws?: { close?: () => void; terminate?: () => void }
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  sender: Sendable
  stopped: boolean
  exitSent: boolean
}

const execs = new Map<string, ExecHandle>()

function sendExecExit(handle: ExecHandle, code: number): void {
  if (handle.exitSent) return
  handle.exitSent = true
  send(handle.sender, CH.onExecExit, { id: handle.id, code })
}

export async function execStart(id: string, req: ExecRequest, sender: Sendable): Promise<boolean> {
  try {
    const kc = getKubeConfig()
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    // client-node treats the stdout stream as the terminal-size source when it
    // exposes columns/rows + 'resize' events.
    ;(stdout as any).columns = 80
    ;(stdout as any).rows = 24

    const handle: ExecHandle = { id, stdin, stdout, stderr, sender, stopped: false, exitSent: false }
    execs.set(id, handle)

    stdout.on('data', (c: Buffer) => {
      send(sender, CH.onExecData, { id, stream: 'stdout', chunk: c.toString() })
    })
    stderr.on('data', (c: Buffer) => {
      send(sender, CH.onExecData, { id, stream: 'stderr', chunk: c.toString() })
    })

    const ws = await new Exec(kc).exec(
      req.namespace,
      req.podName,
      req.container ?? '',
      req.command,
      stdout,
      stderr,
      stdin,
      req.tty ?? true,
      (status: any) => {
        const causes: any[] = status?.details?.causes ?? []
        const cause = causes.find((c) => c?.reason === 'ExitCode')
        const code = Number(cause?.message)
        sendExecExit(handle, Number.isFinite(code) ? code : 0)
      }
    )

    if (handle.stopped) {
      try {
        ws?.close?.()
      } catch {
        /* ignore */
      }
    } else {
      handle.ws = ws
    }
    ;(ws as any)?.on?.('close', () => sendExecExit(handle, 0))
    return true
  } catch (err) {
    send(sender, CH.onExecData, { id, stream: 'stderr', chunk: `[exec failed] ${messageOf(err)}\r\n` })
    const handle = execs.get(id)
    if (handle) sendExecExit(handle, 1)
    execs.delete(id)
    return false
  }
}

export function execWrite(id: string, data: string): void {
  try {
    execs.get(id)?.stdin.write(Buffer.from(data))
  } catch {
    /* stream closed */
  }
}

export function execResize(id: string, cols: number, rows: number): void {
  const handle = execs.get(id)
  if (!handle) return
  try {
    const stream = handle.stdout as any
    stream.columns = cols
    stream.rows = rows
    stream.emit?.('resize')
  } catch {
    /* ignore */
  }
}

export function execStop(id: string): void {
  const handle = execs.get(id)
  if (!handle) return
  execs.delete(id)
  handle.stopped = true
  try {
    handle.stdin.end()
    handle.stdin.destroy()
  } catch {
    /* ignore */
  }
  try {
    handle.stdout.destroy()
    handle.stderr.destroy()
  } catch {
    /* ignore */
  }
  try {
    handle.ws?.close?.()
  } catch {
    /* ignore */
  }
  sendExecExit(handle, 0)
}
