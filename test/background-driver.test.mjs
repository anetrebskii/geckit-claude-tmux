import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { holdTmux } from '../index.mjs'
import { claudeState, readClaude } from '../src/claude-runtime.mjs'

const available = (() => { try { execFileSync('tmux', ['-V']); return true } catch { return false } })()
const until = async (condition) => {
  for (let i = 0; i < 500; i += 1) {
    if (await condition()) return
    await delay(20)
  }
  throw new Error('Timed out waiting for background task')
}

test('reports background work after a partial saved result and tracks it after the foreground turn ends', { skip: !available, timeout: 30000 }, async () => {
  const folder = await realpath(await mkdtemp('/private/tmp/claude-background-driver-'))
  const id = randomUUID()
  const file = join(folder, 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'), id + '.jsonl')
  const events = []
  let closed = false
  const runtime = {
    claudeCommand: () => join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs'), OFF_PLAN: [],
    planOnly: () => ({ ...process.env, CLAUDE_CONFIG_DIR: folder }), claudeState, readClaude,
    claudeFile: async () => await stat(file).catch(() => undefined) ? file : undefined,
  }
  const driver = holdTmux(runtime, { id, root: folder, resume: true, mode: 'manual' }, (event) => events.push(event), () => { closed = true })
  const signals = () => events.flatMap((event) => event.signals)
  const tasks = () => signals().filter((signal) => signal.kind === 'task').map((signal) => signal.task)
  const ended = () => signals().filter((signal) => signal.kind === 'ended')
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, [
      { type: 'assistant', timestamp: '2026-10-10T00:00:00Z', message: { content: [{ type: 'tool_use', id: 'old-use', name: 'Bash', input: { command: 'old command', description: 'Old task' } }] } },
      { type: 'user', timestamp: '2026-10-10T00:00:01Z', toolUseResult: { backgroundTaskId: 'old-task' }, message: { content: [{ type: 'tool_result', tool_use_id: 'old-use', content: '' }] } },
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    driver.send('background')
    await until(() => tasks().some((task) => task.id === 'old-task'))
    assert.equal(tasks().find((task) => task.id === 'old-task').status, 'stopped')
    await until(() => tasks().some((task) => task.id === 'shell-one'))
    const task = tasks().find((task) => task.id === 'shell-one')
    assert.equal(task.status, 'running')
    assert.equal(task.command, 'tail -f copy.log')
    assert.equal(await readFile(task.output, 'utf8'), '')
    await until(() => ended().length === 1)
    await delay(1100)
    assert.equal(tasks().filter((task) => task.id === 'shell-one').length, 1)
    assert.equal(signals().filter((signal) => signal.kind === 'begun').length, 1)
    await writeFile(join(folder, id + '.control'), 'background-end')
    await until(() => tasks().some((task) => task.id === 'shell-one' && task.status === 'completed'))
    assert.equal(ended().length, 1, 'background exit does not start or end a model turn')
    assert.equal(tasks().at(-1).exit, 0)
    const count = tasks().length
    await delay(1100)
    assert.equal(tasks().length, count)
    const log = (await readFile(join(folder, id + '.log'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(log.filter((entry) => entry.prompt).map((entry) => entry.prompt), ['background'])
    assert.equal(log.some((entry) => entry.stopped || entry.escaped), false)
    const skillAt = '2026-10-22T11:35:58.954Z'
    const skillOutput = join(folder, 'forked-helper.jsonl')
    await writeFile(skillOutput, '')
    const fork = { type: 'user', timestamp: skillAt, toolUseResult: { success: true, commandName: 'twinsai:pr-review', status: 'forked', background: true, agentId: 'forked-skill', outputFile: skillOutput }, message: { content: [{ type: 'tool_result', tool_use_id: 'skill-use', content: 'Running in the background as @twinsai-pr-review' }] } }
    await appendFile(file, [
      { type: 'assistant', timestamp: skillAt, message: { content: [{ type: 'tool_use', id: 'skill-use', name: 'Skill', input: { skill: 'twinsai:pr-review' } }] } },
      fork,
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    await until(() => tasks().some((task) => task.id === 'forked-skill'))
    const helper = tasks().find((task) => task.id === 'forked-skill')
    assert.equal(helper.kind, 'local_agent')
    assert.equal(helper.what, 'twinsai:pr-review')
    assert.equal(helper.output, skillOutput)
    assert.equal(helper.status, 'running')
    assert.equal(ended().length, 1, 'a background skill does not end another foreground turn')
    await appendFile(file, JSON.stringify({ type: 'attachment', timestamp: skillAt, attachment: { type: 'queued_command', prompt: '<task-notification><task-id>forked-skill</task-id><status>completed</status></task-notification>' } }) + '\n')
    await until(() => tasks().some((task) => task.id === 'forked-skill' && task.status === 'completed'))
    await appendFile(file, JSON.stringify(fork) + '\n')
    await delay(1100)
    assert.equal(tasks().filter((task) => task.id === 'forked-skill').length, 2, 'replayed launch does not resurrect a finished helper')
    driver.send('background')
    await until(() => ended().length === 2)
    const stoppedAt = '2026-10-12T17:55:21.449Z'
    await appendFile(file, [
      { type: 'assistant', timestamp: stoppedAt, message: { content: [{ type: 'tool_use', id: 'stop-use', name: 'TaskStop', input: { task_id: 'shell-two' } }] } },
      { type: 'user', timestamp: stoppedAt, toolUseResult: { message: 'Successfully stopped task: shell-two (tail -f copy.log)', task_id: 'shell-two', task_type: 'local_bash' }, message: { content: [{ type: 'tool_result', tool_use_id: 'stop-use', content: '{}' }] } },
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    await until(() => tasks().some((task) => task.id === 'shell-two' && task.status === 'stopped'))
    assert.equal(tasks().at(-1).ended, Date.parse(stoppedAt))
    assert.equal(ended().length, 2, 'TaskStop does not change the foreground turn')
    assert.equal(closed, false, 'TaskStop does not close the owning conversation')
    await driver.end()
    assert.equal(closed, true)
    assert.equal(tasks().findLast((task) => task.id === 'shell-two').status, 'stopped')
  } finally {
    await driver.end()
    await rm(folder, { recursive: true, force: true })
  }
})
