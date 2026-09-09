import { ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import type { AiRequest } from '@shared/types'
import * as opencode from './opencode'

export function registerAiIpc(): void {
  ipcMain.handle(CH.aiInfo, async () => {
    try {
      return opencode.getInfo()
    } catch {
      return { available: false, message: 'Failed to query opencode' }
    }
  })

  ipcMain.handle(CH.aiListModels, async () => {
    return opencode.listModels()
  })

  ipcMain.handle(CH.aiStart, async (event, id: string, req: AiRequest) => {
    return opencode.start(id, req, event.sender)
  })

  ipcMain.handle(CH.aiStop, async (_event, id: string) => {
    opencode.stop(id)
  })
}
