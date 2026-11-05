import { StringDecoder } from 'node:string_decoder'
import { open } from 'node:fs/promises'
import { backgroundTasks } from './background-tasks.mjs'

export function backgroundDiscovery(env, now = Date.now) {
  const readers = new Map()
  const reading = new Map()
  const read = async (root, session, path) => {
    const file = await open(path, 'r').catch(() => undefined)
    if (file === undefined) return []
    try {
      const { size, ino } = await file.stat()
      let cached = readers.get(path)
      if (cached === undefined || size < cached.offset || cached.ino !== ino) {
        cached = { reader: backgroundTasks(root, session, env, () => {}, now), offset: 0, remainder: '', decoder: new StringDecoder('utf8'), ino }
        cached.reader.transcript(path)
        readers.set(path, cached)
      }
      while (cached.offset < size) {
        const length = Math.min(64_000, size - cached.offset)
        const { buffer, bytesRead } = await file.read(Buffer.alloc(length), 0, length, cached.offset)
        if (bytesRead === 0) break
        cached.offset += bytesRead
        const lines = (cached.remainder + cached.decoder.write(buffer.subarray(0, bytesRead))).split('\n')
        cached.remainder = lines.pop()
        for (const line of lines) {
          let entry
          try { entry = JSON.parse(line) } catch { continue }
          await cached.reader.read(entry, true)
        }
      }
      await cached.reader.poll(true)
      return cached.reader.snapshot()
    } finally { await file.close() }
  }
  return {
    read(root, session, path) {
      const current = reading.get(path)
      if (current !== undefined) return current
      const pending = read(root, session, path).finally(() => reading.delete(path))
      reading.set(path, pending)
      return pending
    },
    retain(paths) {
      for (const path of readers.keys()) if (!paths.has(path)) readers.delete(path)
    },
  }
}
