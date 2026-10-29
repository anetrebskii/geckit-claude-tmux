import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { backgroundTasks } from '../src/background-tasks.mjs'

const timestamp = '2026-10-11T06:41:57.518Z'
const use = (tool = 'Bash', id = 'use') => ({ type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id, name: tool, input: { description: 'Watch copy', command: 'tail -f copy.log' } }] } })
const result = (data, id = 'use') => ({ type: 'user', timestamp, toolUseResult: data, message: { content: [{ type: 'tool_result', tool_use_id: id, content: '' }] } })
const notice = (id, status, file = '') => ({ type: 'user', isMeta: true, timestamp, message: { content: `<task-notification><task-id>${id}</task-id><status>${status}</status><output-file>${file}</output-file><summary>Background task ${status} (exit code 0)</summary></task-notification>` } })

test('tracks native saved starts and exit markers without treating silence as completion', async () => {
  const folder = await realpath(await mkdtemp('/private/tmp/claude-task-test-'))
  const updates = []
  const tracker = backgroundTasks(folder, 'session', { CLAUDE_CODE_TMPDIR: folder }, (task) => updates.push(task))
  try {
    await tracker.read(use())
    await tracker.read(result({ backgroundTaskId: 'bg92qqid0' }))
    const task = updates.at(-1)
    assert.equal(task.command, 'tail -f copy.log')
    assert.equal(task.what, 'Watch copy')
    assert.equal(task.started, Date.parse(timestamp))
    assert.equal(task.status, 'running')
    assert.equal(task.output, join(folder, `claude-${process.getuid()}`, folder.replace(/[^A-Za-z0-9]/g, '-'), 'session', 'tasks', 'bg92qqid0.output'))
    await tracker.poll()
    assert.equal(updates.length, 1, 'missing file does not complete')
    await mkdir(join(task.output, '..'), { recursive: true })
    await writeFile(task.output, '')
    await tracker.poll()
    assert.equal(updates.length, 1, 'empty file does not complete')
    await writeFile(task.output, 'ordinary output\n[exited with code 0] trailing output')
    await tracker.poll()
    assert.equal(updates.length, 1, 'only a final exit marker completes')
    await writeFile(task.output, 'large output\n'.repeat(100000) + '\n[exited with code 0]\n')
    await tracker.poll()
    assert.equal(updates.at(-1).status, 'completed')
    assert.equal(updates.at(-1).exit, 0)
    assert(updates.at(-1).ended >= task.started)
    await tracker.poll()
    await tracker.read(result({ backgroundTaskId: task.id }))
    assert.equal(updates.length, 2, 'unchanged or duplicate records do not resurrect cleared tasks')
  } finally { await rm(folder, { recursive: true, force: true }) }
})

test('keeps helper output paths and waits for meta completion notices', async () => {
  const folder = await mkdtemp('/private/tmp/claude-helper-test-')
  const file = join(folder, 'agent.jsonl')
  const updates = []
  const tracker = backgroundTasks(folder, 'session', {}, (task) => updates.push(task))
  try {
    await tracker.read(use('Agent'))
    await tracker.read(result({ isAsync: true, agentId: 'agent-one', outputFile: file }))
    assert.equal(updates.at(-1).kind, 'local_agent')
    assert.equal(updates.at(-1).output, file)
    await writeFile(file, '\n[exited with code 0]\n')
    await tracker.poll()
    assert.equal(updates.length, 1, 'helper transcripts are not shell output')
    await tracker.read(notice('agent-one', 'completed', file))
    assert.equal(updates.at(-1).status, 'completed')
    assert.equal(updates.at(-1).exit, 0)
    assert.equal(updates.at(-1).ended, Date.parse(timestamp))
    await tracker.read(notice('agent-one', 'completed', file))
    assert.equal(updates.length, 2)
  } finally { await rm(folder, { recursive: true, force: true }) }
})

test('reports failed output and killed notices, preserving finished tasks on process closure', async () => {
  const folder = await mkdtemp('/private/tmp/claude-failed-task-')
  const updates = []
  const tracker = backgroundTasks(folder, 'session', {}, (task) => updates.push(task))
  try {
    const outputFile = join(folder, 'failed.output')
    await tracker.read(use())
    await tracker.read(result({ backgroundTaskId: 'failed', outputFile }))
    await writeFile(outputFile, '\n[exited with code 7]\n')
    await tracker.poll()
    assert.equal(updates.at(-1).status, 'failed')
    assert.equal(updates.at(-1).exit, 7)
    await tracker.read(use('Monitor'))
    await tracker.read(result({ backgroundTaskId: 'watch' }))
    assert.equal(updates.at(-1).kind, 'monitor')
    await tracker.read(notice('watch', 'killed'))
    assert.equal(updates.at(-1).status, 'stopped')
    await tracker.read(result({ backgroundTaskId: 'running' }))
    tracker.stopped()
    assert.equal(updates.at(-1).id, 'running')
    assert.equal(updates.at(-1).status, 'stopped')
    const count = updates.length
    tracker.stopped()
    assert.equal(updates.length, count)
  } finally { await rm(folder, { recursive: true, force: true }) }
})

test('restores task history silently and stops unresolved work from the old process', async () => {
  const updates = []
  const tracker = backgroundTasks('/private/tmp', 'session', {}, (task) => updates.push(task))
  await tracker.read(use(), true)
  await tracker.read(result({ backgroundTaskId: 'old-running' }), true)
  await tracker.read(result({ backgroundTaskId: 'old-completed' }), true)
  await tracker.read(notice('old-completed', 'completed'), true)
  tracker.stopped(true)
  assert.equal(updates.length, 0)
  tracker.publish()
  assert.deepEqual(updates.map((task) => [task.id, task.status]), [['old-running', 'stopped'], ['old-completed', 'completed']])
})

test('ignores sidechains, foreground helpers and invalid task IDs', async () => {
  const updates = []
  const tracker = backgroundTasks('/private/tmp', 'session', {}, (task) => updates.push(task))
  await tracker.read({ ...result({ backgroundTaskId: 'side' }), isSidechain: true })
  await tracker.read(result({ agentId: 'sync-agent', isAsync: false }))
  await tracker.read(result({ backgroundTaskId: '../outside' }))
  await tracker.read(notice('unknown', 'completed'))
  assert.equal(updates.length, 0)
})

test('ends tasks whose notice was absorbed mid-turn and reads the saved output path without its full stop', async () => {
  const folder = await mkdtemp('/private/tmp/claude-absorbed-task-')
  const file = join(folder, 'b15tpggyl.output')
  const updates = []
  const tracker = backgroundTasks(folder, 'session', {}, (task) => updates.push(task))
  try {
    await tracker.read(use())
    await tracker.read({ type: 'user', timestamp, toolUseResult: { backgroundTaskId: 'b15tpggyl' }, message: { content: [{ type: 'tool_result', tool_use_id: 'use', content: `Command running in background with ID: b15tpggyl. Output is being written to: ${file}. You will be notified when it completes.` }] } })
    assert.equal(updates.at(-1).output, file)
    await tracker.read({ type: 'attachment', timestamp, attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: '<task-notification>\n<task-id>b15tpggyl</task-id>\n<status>completed</status>\n<summary>Background command "Wait" completed (exit code 0)</summary>\n</task-notification>' } })
    assert.equal(updates.at(-1).status, 'completed')
    assert.equal(updates.at(-1).exit, 0)
  } finally { await rm(folder, { recursive: true, force: true }) }
})

test('ends a task from its successful TaskStop result without a notification or exit marker', async () => {
  const updates = []
  const tracker = backgroundTasks('/private/tmp', 'session', {}, (task) => updates.push(task))
  await tracker.read(use())
  await tracker.read(result({ backgroundTaskId: 'bint88s11' }))
  const stop = { ...use('TaskStop', 'stop'), message: { content: [{ type: 'tool_use', id: 'stop', name: 'TaskStop', input: { task_id: 'bint88s11' } }] } }
  await tracker.read(stop)
  assert.equal(updates.length, 1, 'a request is not proof of a successful stop')
  const stopped = result({ message: 'Successfully stopped task: bint88s11 (python3 -m http.server)', task_id: 'bint88s11', task_type: 'local_bash' }, 'stop')
  await tracker.read(stopped)
  assert.equal(updates.at(-1).status, 'stopped')
  assert.equal(updates.at(-1).ended, Date.parse(timestamp))
  assert.equal(updates.at(-1).exit, undefined)
  await tracker.read(stop)
  await tracker.read(stopped)
  assert.equal(updates.length, 2, 'duplicate stop results do not re-emit the task')
})

test('ignores failed, mismatched and unrelated stop results', async () => {
  const updates = []
  const tracker = backgroundTasks('/private/tmp', 'session', {}, (task) => updates.push(task))
  await tracker.read(result({ backgroundTaskId: 'running' }))
  const stop = { type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id: 'stop', name: 'TaskStop', input: { task_id: 'running' } }] } }
  const data = { message: 'Successfully stopped task: running', task_id: 'running' }
  await tracker.read(result(data, 'unrelated'))
  await tracker.read(stop)
  const failed = result(data, 'stop')
  failed.message.content[0].is_error = true
  await tracker.read(failed)
  await tracker.read(stop)
  await tracker.read(result({ ...data, task_id: 'other' }, 'stop'))
  await tracker.read(stop)
  await tracker.read(result({ task_id: 'running', message: 'No such task' }, 'stop'))
  assert.equal(updates.length, 1)
  assert.equal(updates[0].status, 'running')
})

test('recognizes only a final killed marker and preserves the final state', async () => {
  const folder = await mkdtemp('/private/tmp/claude-killed-task-')
  const outputFile = join(folder, 'killed.output')
  const updates = []
  const tracker = backgroundTasks(folder, 'session', {}, (task) => updates.push(task))
  try {
    await tracker.read(result({ backgroundTaskId: 'killed', outputFile }))
    await writeFile(outputFile, 'example [killed]\n')
    await tracker.poll()
    await writeFile(outputFile, '[killed]\nstill running\n')
    await tracker.poll()
    assert.equal(updates.length, 1)
    await writeFile(outputFile, 'server request\n\n[killed]\n')
    await tracker.poll()
    assert.equal(updates.at(-1).status, 'stopped')
    assert.equal(updates.at(-1).exit, undefined)
    const endedAt = updates.at(-1).ended
    await tracker.poll()
    await tracker.read({ type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id: 'stop', name: 'TaskStop', input: { task_id: 'killed' } }] } })
    await tracker.read(result({ task_id: 'killed', message: 'Successfully stopped task: killed' }, 'stop'))
    assert.equal(updates.length, 2)
    assert.equal(updates.at(-1).ended, endedAt)
  } finally { await rm(folder, { recursive: true, force: true }) }
})


test('tracks forked background skills as helpers and preserves completion on replay', async () => {
  const updates = []
  const tracker = backgroundTasks('/private/tmp', 'session', {}, (task) => updates.push(task))
  const skill = { type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id: 'skill-use', name: 'Skill', input: { skill: 'twinsai:pr-review', args: 'review PR 4069' } }] } }
  const launched = result({ success: true, commandName: 'twinsai:pr-review', status: 'forked', background: true, agentId: 'a6ee73680361783b1', result: 'Running in the background as @twinsai-pr-review' }, 'skill-use')
  await tracker.read(skill)
  await tracker.read(launched)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].id, 'a6ee73680361783b1')
  assert.equal(updates[0].kind, 'local_agent')
  assert.equal(updates[0].what, 'twinsai:pr-review')
  assert.equal(updates[0].status, 'running')
  assert.equal(updates[0].started, Date.parse(timestamp))
  assert.match(updates[0].output, /[\/]session[\/]tasks[\/]a6ee73680361783b1\.output$/)
  await tracker.poll()
  await tracker.read(launched)
  assert.equal(updates.length, 1)
  await tracker.read(notice(updates[0].id, 'completed'))
  await tracker.read(launched)
  assert.equal(updates.length, 2)
  assert.equal(updates.at(-1).status, 'completed')
  const restored = []
  const history = backgroundTasks('/private/tmp', 'session', {}, (task) => restored.push(task))
  await history.read(launched, true)
  await history.read(notice(updates[0].id, 'completed'), true)
  history.stopped(true)
  assert.equal(restored.length, 0)
  history.publish()
  assert.equal(restored[0].what, 'twinsai:pr-review')
  assert.equal(restored[0].status, 'completed')
})

test('ignores foreground, failed and malformed forked skill results', async () => {
  const updates = []
  const tracker = backgroundTasks('/private/tmp', 'session', {}, (task) => updates.push(task))
  const fork = { success: true, commandName: 'review', status: 'forked', background: true, agentId: 'agent-one' }
  for (const data of [{ ...fork, background: false }, { ...fork, success: false }, { ...fork, status: 'failed' }, { ...fork, agentId: '../outside' }, { ...fork, agentId: '' }]) await tracker.read(result(data))
  await tracker.read({ ...result(fork), isSidechain: true })
  assert.equal(updates.length, 0)
})


test('tracks Monitor taskId results and their completion without accepting other tool IDs', async () => {
  const updates = []
  const tracker = backgroundTasks('/private/tmp', 'session', {}, (task) => updates.push(task))
  await tracker.read(use('Monitor'))
  const launched = result({ taskId: 'b5rwxq3yc', timeoutMs: 1800000, persistent: false })
  await tracker.read(launched)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].id, 'b5rwxq3yc')
  assert.equal(updates[0].kind, 'monitor')
  assert.equal(updates[0].what, 'Watch copy')
  assert.equal(updates[0].command, 'tail -f copy.log')
  assert.equal(updates[0].started, Date.parse(timestamp))
  await tracker.read(notice('b5rwxq3yc', 'completed'))
  await tracker.read(use('Monitor'))
  await tracker.read(launched)
  assert.equal(updates.length, 2)
  assert.equal(updates.at(-1).status, 'completed')
  await tracker.read(use('TaskGet'))
  await tracker.read(result({ taskId: 'unrelated' }))
  await tracker.read(use('Monitor'))
  const failed = result({ taskId: 'failed' })
  failed.message.content[0].is_error = true
  await tracker.read(failed)
  await tracker.read(use('Monitor'))
  await tracker.read(result({ taskId: '../outside' }))
  assert.equal(updates.length, 2)
})
