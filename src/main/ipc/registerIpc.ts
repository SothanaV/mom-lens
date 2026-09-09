import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import type { ExecRequest, ListRequest, LogRequest, ResourceScopeRef } from '@shared/types'
import * as kubeconfig from '../k8s/kubeconfig'
import * as resources from '../k8s/resources'
import * as metrics from '../k8s/metrics'
import * as streams from '../k8s/streams'

export function registerIpc(): void {
  ipcMain.handle(CH.listContexts, async () => {
    return kubeconfig.listContexts()
  })

  ipcMain.handle(CH.useContext, async (_event, name: string) => {
    return kubeconfig.useContext(name)
  })

  ipcMain.handle(CH.currentContext, async () => {
    return kubeconfig.currentContext()
  })

  ipcMain.handle(CH.listNodes, async () => {
    return resources.listNodes()
  })

  ipcMain.handle(CH.listNamespaces, async () => {
    return resources.listNamespaces()
  })

  ipcMain.handle(CH.listResources, async (_event, req: ListRequest) => {
    return resources.listResources(req)
  })

  ipcMain.handle(CH.getResource, async (_event, ref: ResourceScopeRef) => {
    return resources.getResource(ref)
  })

  ipcMain.handle(CH.deleteResource, async (_event, ref: ResourceScopeRef) => {
    return resources.deleteResource(ref)
  })

  ipcMain.handle(CH.applyYaml, async (_event, yamlText: string) => {
    return resources.applyYaml(yamlText)
  })

  ipcMain.handle(CH.topNodes, async () => {
    return metrics.topNodes()
  })

  ipcMain.handle(CH.topPods, async (_event, namespace?: string) => {
    return metrics.topPods(namespace)
  })

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
