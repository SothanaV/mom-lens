// Headless test of the opencode AI pipeline (src/main/ai/opencode) — no Electron needed.
// Spawns a real `opencode run --format json` and streams the result through a fake sender.
// Run: pnpm test:ai   (requires a working local opencode install)
import { randomUUID } from 'crypto'
import * as os from 'os'
import * as path from 'path'
import { getInfo, start } from '../src/main/ai/opencode'
import { CH } from '../src/shared/ipc'
import type { AiDone } from '../src/shared/types'

function main(): Promise<void> {
  const info = getInfo()
  console.log('ai info:', JSON.stringify(info))
  if (!info.available) return Promise.reject(new Error('opencode not available: ' + info.message))

  const id = randomUUID()
  let text = ''
  let textEvents = 0
  let finish: (d: AiDone) => void = () => {}
  const done = new Promise<AiDone>((res) => (finish = res))

  const sender = {
    isDestroyed: () => false,
    send: (channel: string, payload: { chunk?: string } & AiDone) => {
      if (channel === CH.onAiData) {
        textEvents += 1
        text += payload.chunk ?? ''
      } else if (channel === CH.onAiDone) {
        finish(payload)
      }
    }
  }

  start(
    id,
    {
      prompt: 'Reply with exactly this and nothing else: SOL AI PIPELINE OK',
      cwd: path.join(os.tmpdir(), 'momlens-ai-smoke')
    },
    sender
  )

  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('opencode run timed out after 180s')), 180000)
  )

  const processed = done.then((d) => {
    console.log('textEvents :', textEvents)
    console.log('reply      :', JSON.stringify(text.trim()))
    console.log('sessionID  :', d.sessionID, '| error:', d.error ?? '(none)')
    if (d.error) throw new Error('ai error: ' + d.error)
    if (text.trim().length === 0) throw new Error('no assistant text streamed')
    if (!d.sessionID) throw new Error('sessionID was not captured')
    console.log('\nAI SMOKE OK ✅')
  })

  return Promise.race([processed, timeout])
}

main().catch((err) => {
  console.error('\nAI SMOKE FAILED:', err?.message ?? err)
  process.exit(1)
})
