import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/ipc'
import type {
  SoLensApi,
  ResourceEvent,
  LogsData,
  ExecData,
  AiData,
  AiDone,
  ListRequest,
  LogRequest,
  ExecRequest,
  AiRequest,
  ResourceScopeRef
} from '../shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: SoLensApi = {
  k8s: {
    listContexts: () => ipcRenderer.invoke(CH.listContexts),
    useContext: (name: string) => ipcRenderer.invoke(CH.useContext, name),
    currentContext: () => ipcRenderer.invoke(CH.currentContext),
    listNodes: () => ipcRenderer.invoke(CH.listNodes),
    listNamespaces: () => ipcRenderer.invoke(CH.listNamespaces),
    listResources: (req: ListRequest) => ipcRenderer.invoke(CH.listResources, req),
    getResource: (ref: ResourceScopeRef) => ipcRenderer.invoke(CH.getResource, ref),
    deleteResource: (ref: ResourceScopeRef) => ipcRenderer.invoke(CH.deleteResource, ref),
    applyYaml: (yaml: string) => ipcRenderer.invoke(CH.applyYaml, yaml),
    topNodes: () => ipcRenderer.invoke(CH.topNodes),
    topPods: (ns?: string) => ipcRenderer.invoke(CH.topPods, ns),
    watchStart: (id: string, req: ListRequest) => ipcRenderer.invoke(CH.watchStart, id, req),
    watchStop: (id: string) => ipcRenderer.invoke(CH.watchStop, id),
    logsStart: (id: string, req: LogRequest) => ipcRenderer.invoke(CH.logsStart, id, req),
    logsStop: (id: string) => ipcRenderer.invoke(CH.logsStop, id),
    execStart: (id: string, req: ExecRequest) => ipcRenderer.invoke(CH.execStart, id, req),
    execWrite: (id: string, data: string) => ipcRenderer.invoke(CH.execWrite, id, data),
    execResize: (id: string, cols: number, rows: number) => ipcRenderer.invoke(CH.execResize, id, cols, rows),
    execStop: (id: string) => ipcRenderer.invoke(CH.execStop, id)
  },
  ai: {
    info: () => ipcRenderer.invoke(CH.aiInfo),
    listModels: () => ipcRenderer.invoke(CH.aiListModels),
    start: (id: string, req: AiRequest) => ipcRenderer.invoke(CH.aiStart, id, req),
    stop: (id: string) => ipcRenderer.invoke(CH.aiStop, id)
  },
  events: {
    onResourceEvent: (cb) => on<ResourceEvent>(CH.onResourceEvent, cb),
    onLogsData: (cb) => on<LogsData>(CH.onLogsData, cb),
    onLogsError: (cb) => on<{ id: string; message: string }>(CH.onLogsError, cb),
    onExecData: (cb) => on<ExecData>(CH.onExecData, cb),
    onExecExit: (cb) => on<{ id: string; code: number }>(CH.onExecExit, cb),
    onAiData: (cb) => on<AiData>(CH.onAiData, cb),
    onAiDone: (cb) => on<AiDone>(CH.onAiDone, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
