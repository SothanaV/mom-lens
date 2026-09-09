// IPC channel names. Main registers invoke handlers; main -> renderer uses the on* channels.

export const CH = {
  // invoke (renderer -> main, promise)
  listContexts: 'k8s:listContexts',
  useContext: 'k8s:useContext',
  currentContext: 'k8s:currentContext',
  listNodes: 'k8s:listNodes',
  listNamespaces: 'k8s:listNamespaces',
  listResources: 'k8s:listResources',
  getResource: 'k8s:getResource',
  deleteResource: 'k8s:deleteResource',
  applyYaml: 'k8s:applyYaml',
  topNodes: 'k8s:topNodes',
  topPods: 'k8s:topPods',
  watchStart: 'k8s:watchStart',
  watchStop: 'k8s:watchStop',
  logsStart: 'k8s:logsStart',
  logsStop: 'k8s:logsStop',
  execStart: 'k8s:execStart',
  execWrite: 'k8s:execWrite',
  execResize: 'k8s:execResize',
  execStop: 'k8s:execStop',

  // events (main -> renderer)
  onResourceEvent: 'k8s:resource-event',
  onLogsData: 'k8s:logs-data',
  onLogsError: 'k8s:logs-error',
  onExecData: 'k8s:exec-data',
  onExecExit: 'k8s:exec-exit',

  // AI (opencode integration)
  aiInfo: 'ai:info',
  aiListModels: 'ai:listModels',
  aiStart: 'ai:start',
  aiStop: 'ai:stop',
  onAiData: 'ai:data',
  onAiDone: 'ai:done'
} as const
