import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { backgroundDiscovery } from '../src/background-discovery.mjs'
import { ACTIVITY_WINDOW, backgroundTasks } from '../src/background-tasks.mjs'

const base = Date.parse('2026-11-05T16:54:00Z')
const entry = (time, type, data) => ({ timestamp: new Date(time).toISOString(), type, ...data })
const launch = (time, id) => entry(time, 'user', { toolUseResult: { isAsync: true, agentId: id }, message: { content: [] } })
const done = (time, id, status = 'completed') => entry(time, 'user', { message: { content: `<task-notification><task-id>${id}</task-id><status>${status}</status></task-notification>` } })
const tool = (time, name, id = 'use') => entry(time, 'assistant', { isSidechain: true, message: { content: [{ type: 'tool_use', id, name, input: {} }] } })
const lines = (entries) => entries.map(JSON.stringify).join('\n') + '\n'

test('discovers resumed helpers after an old completion; independently reconciles restart, stale, stop and error', async () => {
  const folder = await mkdtemp('/private/tmp/discovery-')
  let now = base
  const path = join(folder, 'parent.jsonl')
  const helper = (id) => join(folder, 'parent', 'subagents', `agent-${id}.jsonl`)
  try {
    await mkdir(join(folder, 'parent', 'subagents'), { recursive: true })
    await writeFile(path, lines([launch(base - 10000, 'one'), done(base - 9000, 'one'), launch(base - 10000, 'two')]))
    await writeFile(helper('one'), lines([tool(base - 1000, 'mcp__claude-in-chrome__computer')]))
    await writeFile(helper('two'), lines([tool(base - 2000, 'Bash')]))
    const discovery = backgroundDiscovery({}, () => now)
    let tasks = await discovery.read(folder, 'parent', path)
    assert.equal(tasks.length, 2)
    assert.equal(tasks[0].status, 'running', 'new child activity resumes the completed ID')
    assert.equal(tasks[0].ended, undefined)
    assert.equal(tasks[0].activity, 'browser')
    assert.equal(tasks[0].activityTool, 'mcp__claude-in-chrome__computer')
    assert.equal(tasks[1].status, 'running')
    await appendFile(path, lines([done(base + 1, 'two', 'failed')]))
    tasks = await discovery.read(folder, 'parent', path)
    assert.equal(tasks[0].status, 'running')
    assert.equal(tasks[1].status, 'failed')
    await appendFile(helper('one'), lines([tool(base + 2, 'AskUserQuestion')]))
    now = base + 2
    tasks = await discovery.read(folder, 'parent', path)
    assert.equal(tasks[0].status, 'asks')
    now += ACTIVITY_WINDOW + 1
    tasks = await discovery.read(folder, 'parent', path)
    assert.equal(tasks[0].status, 'unknown', 'silence never proves completion or stop')
    const restarted = backgroundDiscovery({}, () => now)
    assert.deepEqual(await restarted.read(folder, 'parent', path), tasks, 'restart recovers the same facts without launching Claude')
    await appendFile(path, lines([done(now, 'one', 'stopped'), launch(base - 10000, 'one')]))
    tasks = await discovery.read(folder, 'parent', path)
    assert.equal(tasks[0].status, 'stopped', 'stale launch does not resurrect stopped helper')
    assert.equal(tasks[1].status, 'failed')
    await appendFile(helper('one'), lines([tool(base - 500, 'Bash')]))
    assert.equal((await discovery.read(folder, 'parent', path))[0].status, 'stopped')
  } finally { await rm(folder, { recursive: true, force: true }) }
})

test('partial records, missing telemetry and process-like shell markers never claim active or stopped helpers', async () => {
  const folder = await mkdtemp('/private/tmp/discovery-partial-')
  const path = join(folder, 'parent.jsonl')
  try {
    await writeFile(path, lines([launch(base - ACTIVITY_WINDOW - 1, 'missing')]) + JSON.stringify(launch(base, 'partial')))
    const discovery = backgroundDiscovery({}, () => base)
    let tasks = await discovery.read(folder, 'parent', path)
    assert.deepEqual(tasks.map((t) => t.status), ['unknown'])
    await appendFile(path, '\n')
    tasks = await discovery.read(folder, 'parent', path)
    assert.equal(tasks.length, 2)
    assert.equal(tasks[1].status, 'running', 'fresh launch is evidence of native acceptance')
    await writeFile(path, lines([launch(base - ACTIVITY_WINDOW - 1, 'replaced')]))
    tasks = await discovery.read(folder, 'parent', path)
    assert.deepEqual(tasks.map((t) => t.id), ['replaced'], 'truncated parent resets parser')
    assert.equal(tasks[0].status, 'unknown')
  } finally { await rm(folder, { recursive: true, force: true }) }
})

test('a newer native async launch resumes the same helper ID, but replay does not', async () => {
  const folder = await mkdtemp('/private/tmp/discovery-resume-')
  const path = join(folder, 'parent.jsonl')
  try {
    const discovery = backgroundDiscovery({}, () => base)
    await writeFile(path, lines([launch(base - 10000, 'one'), done(base - 9000, 'one'), launch(base - 10000, 'one')]))
    assert.equal((await discovery.read(folder, 'parent', path))[0].status, 'completed')
    await appendFile(path, lines([launch(base, 'one')]))
    const task = (await discovery.read(folder, 'parent', path))[0]
    assert.equal(task.status, 'running')
    assert.equal(task.ended, undefined)
    assert.equal(task.observedAt, base)
  } finally { await rm(folder, { recursive: true, force: true }) }
})

test('ignores an old successful TaskStop result after newer helper evidence', async () => {
  const tasks = backgroundTasks('/fixture', 'parent', {}, () => {}, () => base)
  await tasks.read(launch(base, 'one'))
  await tasks.read(entry(base - 1000, 'assistant', { message: { content: [{ type: 'tool_use', id: 'stop-old', name: 'TaskStop', input: { task_id: 'one' } }] } }))
  await tasks.read(entry(base - 999, 'user', { toolUseResult: { task_id: 'one', message: 'Successfully stopped task: one' }, message: { content: [{ type: 'tool_result', tool_use_id: 'stop-old', content: '' }] } }))
  assert.equal(tasks.snapshot()[0].status, 'running')
  assert.equal(tasks.snapshot()[0].observedAt, base)
})

test('coalesces concurrent discovery without skipping chunks or returning incomplete children', async () => {
  const folder = await mkdtemp('/private/tmp/discovery-concurrent-')
  const path = join(folder, 'parent.jsonl')
  try {
    const filler = JSON.stringify({ type: 'ignored', padding: 'a'.repeat(1000) }) + '\n'
    await writeFile(path, lines([launch(base, 'first')]) + filler.repeat(75) + lines([launch(base, 'middle')]) + filler.repeat(75) + lines([launch(base, 'last')]))
    const discovery = backgroundDiscovery({}, () => base)
    const rows = await Promise.all(Array.from({ length: 4 }, () => discovery.read(folder, 'parent', path)))
    for (const tasks of rows) assert.deepEqual(tasks.map((task) => task.id), ['first', 'middle', 'last'])
    await appendFile(path, lines([done(base + 1, 'middle')]))
    assert.equal((await discovery.read(folder, 'parent', path))[1].status, 'completed')
  } finally { await rm(folder, { recursive: true, force: true }) }
})
