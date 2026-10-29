import { open, realpath } from 'node:fs/promises'
import { join } from 'node:path'

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
const string = (value) => typeof value === 'string' ? value : ''
const content = (entry) => object(entry.message).content
const blocks = (entry) => Array.isArray(content(entry)) ? content(entry) : []
const texts = (entry) => typeof content(entry) === 'string' ? [content(entry)] : blocks(entry).filter((block) => block.type === 'text').map((block) => string(block.text))
const ended = { completed: 'completed', failed: 'failed', stopped: 'stopped', killed: 'stopped' }
const tag = (text, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() ?? ''
const at = (entry) => Date.parse(entry.timestamp) || Date.now()

export function backgroundTasks(root, session, env, changed) {
  const tools = new Map()
  const tasks = new Map()
  let directory
  const output = async (id) => {
    directory ??= Promise.all([
      realpath(env.CLAUDE_CODE_TMPDIR ?? '/tmp').catch(() => env.CLAUDE_CODE_TMPDIR ?? '/tmp'),
      realpath(root).catch(() => root),
    ]).then(([temp, folder]) => join(temp, `claude-${process.getuid()}`, folder.replace(/[^A-Za-z0-9]/g, '-'), session, 'tasks'))
    return join(await directory, `${id}.output`)
  }
  const keep = (task, silent) => {
    const previous = tasks.get(task.id)
    if (previous !== undefined && Object.keys(previous).length === Object.keys(task).length && Object.entries(task).every(([key, value]) => previous[key] === value)) return
    tasks.set(task.id, task)
    if (!silent) changed(task)
  }
  const told = (entry, text, silent) => {
    const notice = /^\s*<task-notification>([\s\S]*)<\/task-notification>\s*$/.exec(text)?.[1]
    if (notice === undefined) return
    const task = tasks.get(tag(notice, 'task-id'))
    const status = ended[tag(notice, 'status')]
    if (task === undefined || status === undefined) return
    const file = tag(notice, 'output-file')
    const exit = /exit code (-?\d+)/.exec(tag(notice, 'summary'))?.[1]
    keep({ ...task, status, ended: task.ended ?? at(entry), ...(file === '' ? {} : { output: file }), ...(exit === undefined ? {} : { exit: Number(exit) }) }, silent)
  }
  return {
    async read(entry, silent = false) {
      if (entry.isSidechain === true) return
      if (entry.type === 'assistant') {
        for (const use of blocks(entry)) {
          if (use.type === 'tool_use') tools.set(use.id, { tool: use.name, input: object(use.input), started: at(entry) })
        }
        return
      }
      // A notice that arrives while Claude is working is absorbed into the turn and saved as an attachment.
      if (entry.type === 'attachment' && object(entry.attachment).type === 'queued_command') return told(entry, string(object(entry.attachment).prompt), silent)
      if (entry.type !== 'user') return
      const result = object(entry.toolUseResult ?? entry.tool_use_result)
      const results = blocks(entry).filter((block) => block.type === 'tool_result')
      const use = results[0]?.tool_use_id
      const started = tools.get(use)
      if (started?.tool === 'TaskStop' && results[0]?.is_error !== true) {
        const task = tasks.get(string(result.task_id))
        const stopped = /^Successfully stopped task: ([A-Za-z0-9_-]+)(?: \(|$)/.exec(string(result.message))?.[1]
        if (task?.status === 'running' && task.id === started.input.task_id && task.id === stopped) {
          keep({ ...task, status: 'stopped', ended: at(entry) }, silent)
        }
      }
      const forked = result.success === true && result.status === 'forked' && result.background === true
      const helper = result.isAsync === true || forked
      const id = string(result.backgroundTaskId) || (helper ? string(result.agentId) : started?.tool === 'Monitor' && results[0]?.is_error !== true ? string(result.taskId) : '')
      if (/^[A-Za-z0-9_-]+$/.test(id)) {
        const previous = tasks.get(id)
        const body = results.map((block) => typeof block.content === 'string' ? block.content : '').join('\n')
        const file = string(result.outputFile) || /(?:Output is being written to|output_file): (\S+?)\.?(?:\s|$)/.exec(body)?.[1]
        keep({
          id, kind: started?.tool === 'Agent' || helper ? 'local_agent' : started?.tool === 'Monitor' ? 'monitor' : 'local_bash',
          what: string(started?.input.description) || (forked ? string(started?.input.skill) || string(result.commandName) : '') || previous?.what || id,
          status: 'running', started: started?.started ?? previous?.started ?? at(entry),
          ...(string(started?.input.command) === '' ? {} : { command: started.input.command }),
          ...(use === undefined ? {} : { use }),
          ...previous,
          output: file || previous?.output || await output(id),
        }, silent)
      }
      for (const result of results) tools.delete(result.tool_use_id)
      for (const text of texts(entry)) told(entry, text, silent)
    },
    async poll(silent = false) {
      for (const task of tasks.values()) {
        if (task.status !== 'running' || task.kind === 'local_agent') continue
        const file = await open(task.output, 'r').catch(() => undefined)
        if (file === undefined) continue
        try {
          const { size, mtimeMs } = await file.stat()
          const length = Math.min(512, size)
          const { buffer, bytesRead } = await file.read(Buffer.alloc(length), 0, length, size - length)
          const marker = /(?:^|\n)\[(?:exited with code (-?\d+)|(killed))\]\s*$/.exec(buffer.subarray(0, bytesRead).toString('utf8'))
          if (marker?.[2] === 'killed') keep({ ...task, status: 'stopped', ended: mtimeMs }, silent)
          else if (marker?.[1] !== undefined) keep({ ...task, status: Number(marker[1]) === 0 ? 'completed' : 'failed', ended: mtimeMs, exit: Number(marker[1]) }, silent)
        } catch {} finally {
          await file.close()
        }
      }
    },
    stopped(silent = false) {
      tools.clear()
      for (const task of tasks.values()) {
        if (task.status === 'running') keep({ ...task, status: 'stopped', ended: Date.now() }, silent)
      }
    },
    publish() {
      for (const task of tasks.values()) changed(task)
    },
  }
}
