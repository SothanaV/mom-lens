import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import type {
  ActionResult,
  CurrentContextResult,
  ExecRequest,
  GetResult,
  KubeApiError,
  KubeContextsResult,
  KubeListResult,
  ListPage,
  ListPageRequest,
  ListRequest,
  LogRequest,
  NodeMetrics,
  NodeMetricsResult,
  PodMetrics,
  PodMetricsResult,
  ResourceScopeRef
} from '@shared/types'
import * as kubeconfig from '../k8s/kubeconfig'
import * as resources from '../k8s/resources'
import * as metrics from '../k8s/metrics'
import * as streams from '../k8s/streams'
import { toKubeError } from '../k8s/errors'

/**
 * The k8s service functions already resolve the typed in-band error shape
 * (`{ error: KubeApiError }`). This wrapper is a last-resort net so no k8s
 * handler can ever reject with a bare "Error invoking remote method" string:
 * an unexpected throw (e.g. a broken kubeconfig surfacing from the lazy load
 * inside the client factory) is converted into the SAME in-band shape.
 * Streaming channels keep their own event-based error reporting;
 * `useContext` keeps rejecting like it always has (the Catalog page catches).
 */
function guarded<A extends unknown[], T>(
  fallback: (err: unknown) => T,
  run: (event: IpcMainInvokeEvent, ...args: A) => T | Promise<T>
): (event: IpcMainInvokeEvent, ...args: A) => Promise<T> {
  return async (event, ...args) => {
    try {
      return await run(event, ...args)
    } catch (err) {
      return fallback(err)
    }
  }
}

const listFallback = (err: unknown): KubeListResult => ({ items: [], error: toKubeError(err) })
const pageFallback = (err: unknown): ListPage => ({ items: [], error: toKubeError(err) })
const getFallback = (err: unknown): GetResult => ({ error: toKubeError(err) })
const contextsFallback = (err: unknown): KubeContextsResult => ({
  items: [],
  error: toKubeError(err)
})
const currentContextFallback = (err: unknown): CurrentContextResult => ({
  error: toKubeError(err)
})
const actionFallback = (err: unknown): ActionResult => {
  const error = toKubeError(err)
  return { ok: false, message: error.message, error }
}
const metricsFallback = <T,>(err: unknown): { items: T[]; available: false; error: KubeApiError } => ({
  items: [],
  available: false,
  error: toKubeError(err)
})

export function registerIpc(): void {
  ipcMain.handle(CH.listContexts, guarded(contextsFallback, () => kubeconfig.listContexts()))

  ipcMain.handle(CH.useContext, async (_event, name: string) => {
    return kubeconfig.useContext(name)
  })

  ipcMain.handle(
    CH.currentContext,
    guarded(currentContextFallback, () => kubeconfig.currentContext())
  )

  ipcMain.handle(CH.listNodes, guarded(listFallback, () => resources.listNodes()))

  ipcMain.handle(CH.listNamespaces, guarded(listFallback, () => resources.listNamespaces()))

  ipcMain.handle(
    CH.listResources,
    guarded(listFallback, (_event, req: ListRequest) => resources.listResources(req))
  )

  ipcMain.handle(
    CH.listResourcesPage,
    guarded(pageFallback, (_event, req: ListPageRequest) => resources.listResourcesPage(req))
  )

  ipcMain.handle(
    CH.getResource,
    guarded(getFallback, (_event, ref: ResourceScopeRef) => resources.getResource(ref))
  )

  ipcMain.handle(
    CH.deleteResource,
    guarded(actionFallback, (_event, ref: ResourceScopeRef) => resources.deleteResource(ref))
  )

  ipcMain.handle(
    CH.applyYaml,
    guarded(actionFallback, (_event, yamlText: string) => resources.applyYaml(yamlText))
  )

  ipcMain.handle(
    CH.topNodes,
    guarded(
      (err: unknown): NodeMetricsResult => metricsFallback<NodeMetrics>(err),
      () => metrics.topNodes()
    )
  )

  ipcMain.handle(
    CH.topPods,
    guarded(
      (err: unknown): PodMetricsResult => metricsFallback<PodMetrics>(err),
      (_event, namespace?: string) => metrics.topPods(namespace)
    )
  )

  ipcMain.handle(CH.watchStart, async (event, id: string, req: ListRequest) => {
    return streams.watchStart(id, req, event.sender)
  })

  ipcMain.handle(CH.watchStop, async (_event, id: string) => {
    return streams.watchStop(id)
  })

  ipcMain.handle(CH.logsStart, async (event, id: string, req: LogRequest) => {
    return streams.logsStart(id, req, event.sender)
  })

  ipcMain.handle(CH.logsStop, async (_event, id: string) => {
    return streams.logsStop(id)
  })

  ipcMain.handle(CH.execStart, async (event, id: string, req: ExecRequest) => {
    return streams.execStart(id, req, event.sender)
  })

  ipcMain.handle(CH.execWrite, async (_event, id: string, data: string) => {
    streams.execWrite(id, data)
  })

  ipcMain.handle(CH.execResize, async (_event, id: string, cols: number, rows: number) => {
    streams.execResize(id, cols, rows)
  })

  ipcMain.handle(CH.execStop, async (_event, id: string) => {
    streams.execStop(id)
  })
}
