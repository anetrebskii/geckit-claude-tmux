import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { create, holdTmux, planNow, terminalScreen, usageReader, usageScreen } from '../index.mjs'

const available = (() => {
  try { execFileSync('tmux', ['-V']); return process.platform !== 'win32' }
  catch { return false }
})()
const until = async (condition) => {
  for (let count = 0; count < 500; count += 1) {
    if (await condition()) return
    await delay(20)
  }
  throw new Error('Timed out waiting for Claude Code.')
}
const idle = '────────────────────\n❯\u00a0Try "ask anything"\n────────────────────\n  custom status line\n'
test('recognizes native states without interpreting reply text as a selection', () => {
  assert.equal(terminalScreen(idle).kind, 'idle')
  assert.equal(terminalScreen('✶ Working…\n' + idle).kind, 'working')
  assert.equal(terminalScreen('❯ 1. A\n  2. B\n' + idle).kind, 'idle')
  assert.equal(terminalScreen('No recognized prompt').kind, 'unknown')
  assert.equal(terminalScreen('⏺ The hint says esc to interrupt\n' + idle).kind, 'idle')
  assert.equal(terminalScreen('✻ Sautéed for 3s · done\n' + idle).kind, 'idle')
  const screen = terminalScreen('Run command?\nnpm test\n  1. Yes\n❯ 2. Yes, allow this session\n  3. No\nEnter to select · Esc to cancel')
  assert.equal(screen.kind, 'question')
  assert.equal(screen.focus, 1)
  assert.deepEqual(screen.options.map((one) => one.label), ['Yes', 'Yes, allow this session', 'No'])
  const native = terminalScreen('Previous reply\n────────────────────\n ☐ Color\n\nWhich option do you choose?\n\n❯ 1. Red\n     Choose Red.\n  2. Blue\n     Choose Blue.\n  3. Type something.\n────────────────────\n  4. Chat about this\nEnter to select · ↑/↓ to navigate · Esc to cancel')
  assert.equal(native.kind, 'question')
  assert.equal(native.title, '☐ Color\nWhich option do you choose?')
  assert.deepEqual(native.options.map((one) => one.label), ['Red', 'Blue', 'Type something.', 'Chat about this'])
  assert.equal(terminalScreen('Quick safety check:\nIs this a project you created or one you trust?\nEnter to confirm').trust, true)
})
test('reads the plan windows from the /usage screen', () => {
  const now = new Date(2026, 9, 9, 10, 0).getTime()
  const plan = usageScreen('Current session\n████   4% used\nResets 1:40pm (Europe/Samara)\n\nCurrent week (all models)\n██  61% used\nResets Oct 14, 9am (Europe/Samara)\n', now)
  assert.deepEqual(plan, { fiveHour: { part: 0.04, resetsAt: new Date(2026, 9, 9, 13, 40).getTime() }, sevenDay: { part: 0.61, resetsAt: new Date(2026, 9, 14, 9, 0).getTime() } })
  assert.equal(usageScreen('Resets 9am\nCurrent session\n', now), undefined)
  const late = new Date(2026, 9, 9, 23, 0).getTime()
  assert.equal(usageScreen('Current session\n10% used\nResets 2am (Europe/Samara)\n', late).fiveHour.resetsAt, new Date(2026, 9, 10, 2, 0).getTime())
})

test('counts a passed reset as an empty window without asking again', () => {
  const resetsAt = new Date(2026, 9, 9, 13, 40).getTime()
  const plan = { fiveHour: { part: 0.9, resetsAt }, sevenDay: { part: 0.5, resetsAt: resetsAt + 86400000 } }
  assert.deepEqual(planNow(plan, resetsAt - 1), plan)
  assert.deepEqual(planNow(plan, resetsAt + 1), { fiveHour: { part: 0, resetsAt: resetsAt + 5 * 3600000 }, sevenDay: plan.sevenDay })
})

test('refreshes /usage only after sent messages and the cooldown, sharing concurrent checks', { skip: !available, timeout: 50000 }, async (t) => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'claude-usage-test-')))
  const binary = join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs')
  await chmod(binary, 0o755)
  const log = join(folder, 'undefined.log')
  let now = new Date(2026, 9, 9, 9, 0).getTime()
  t.mock.method(Date, 'now', () => now)
  const events = []
  const usage = usageReader({ claudeCommand: () => binary, OFF_PLAN: [], planOnly: () => ({ ...process.env, CLAUDE_CONFIG_DIR: folder, CLAUDE_TEST_TRUST: '1' }) }, { name: `usage-${randomUUID().slice(0, 8)}`, folder: join(folder, 'usage'), every: () => 3600000, log: (level, event, fields) => events.push({ level, event, fields }) })
  const asked = async () => (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((one) => one.prompt === '/usage').length
  try {
    const first = await usage.plan()
    assert.equal(first.fiveHour.part, 0.25)
    assert.equal(first.sevenDay.part, 0.07)
    assert.equal(new Date(first.sevenDay.resetsAt).getDate(), 14)
    usage.heard({ fiveHour: { part: 0.3, resetsAt: first.fiveHour.resetsAt } })
    assert.equal((await usage.plan()).fiveHour.part, 0.3)
    assert.equal(await asked(), 1)

    now += 3600001
    assert.equal((await usage.plan()).fiveHour.part, 0.3)
    assert.equal(await asked(), 1, 'elapsed cooldown without messages must not refresh')
    usage.sent()
    const refresh = usage.plan()
    usage.sent()
    const concurrent = usage.plan()
    const refreshed = await refresh
    assert.deepEqual(await concurrent, refreshed)
    assert.equal(refreshed.fiveHour.part, 0.25)
    assert.equal(await asked(), 2)
    await usage.plan()
    assert.equal(await asked(), 2, 'a message does not bypass the cooldown')

    now += 3600001
    await usage.plan()
    assert.equal(await asked(), 3, 'a message sent during the previous check is retained')
    now += 3600001
    await usage.plan()
    assert.equal(await asked(), 3, 'a completed check consumes only its preceding messages')
    usage.heard({ fiveHour: { part: 0.4, resetsAt: now + 10000 } })
    assert.equal((await usage.plan()).fiveHour.part, 0.4)
    assert.equal(await asked(), 3, 'transcript limit events do not count as messages')
    now += 10001
    assert.equal((await usage.plan()).fiveHour.part, 0)
    assert.equal(await asked(), 3, 'cached resets do not cause checks')
    assert.equal(events.filter((one) => one.event === 'usage.command.sent').length, await asked())
    assert.deepEqual(events.filter((one) => one.event === 'usage.check.started').map((one) => one.fields.messagesSinceCheck), [0, 1, 1])
    assert.deepEqual(events.filter((one) => one.event === 'usage.command.sent').map((one) => one.fields.checkId), [1, 2, 3])
    assert.equal(events.filter((one) => one.event === 'usage.check.completed').length, 3)
    for (const reason of ['no-new-messages', 'cooldown', 'in-flight']) assert(events.some((one) => one.event === 'usage.check.skipped' && one.fields.reason === reason), reason)
    assert(events.filter((one) => one.event === 'usage.check.completed').every((one) => one.fields.nextCheckAt > now - 4 * 3600000))
  } finally {
    await usage.dispose()
    await rm(folder, { recursive: true, force: true })
  }
})

test('failed checks wait for new messages and failed sends do not trigger retries', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'claude-usage-failure-'))
  const log = join(folder, 'tmux.log')
  const binary = join(folder, 'tmux')
  await writeFile(binary, `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(log)}, process.argv[2] + '\\n');\nprocess.exit(1);\n`, { mode: 0o755 })
  const runtime = {
    claudeCommand: () => 'unused', OFF_PLAN: [],
    planOnly: () => ({ ...process.env, PATH: folder }),
    claudeState: () => ({}), claudeFile: async () => undefined,
  }
  const logs = []
  const usage = usageReader(runtime, { folder, every: () => 0, log: (level, event, fields) => logs.push({ level, event, fields }) })
  const events = []
  const driver = holdTmux(runtime, { id: randomUUID(), root: folder, mode: 'manual' }, (event) => events.push(event), () => {}, () => usage.sent())
  const attempts = async () => (await readFile(log, 'utf8')).split('\n').filter((line) => line === 'has-session').length
  try {
    assert.equal(await usage.plan(), undefined)
    assert.equal(await usage.plan(), undefined)
    assert.equal(await attempts(), 1)
    driver.send('failed startup')
    await until(() => events.flatMap((event) => event.signals).some((signal) => signal.kind === 'ended' && signal.how === 'failed'))
    assert.equal(await usage.plan(), undefined)
    assert.equal(await attempts(), 1, 'failed submission must not schedule a check')
    usage.sent()
    assert.equal(await usage.plan(), undefined)
    assert.equal(await attempts(), 2, 'a new message permits another attempt')
    await usage.plan()
    assert.equal(await attempts(), 2)
    assert.equal(logs.filter((one) => one.event === 'usage.check.failed').length, 2)
    assert.equal(logs.filter((one) => one.event === 'usage.command.sent').length, 0)
    assert.equal(JSON.stringify(logs).includes('failed startup'), false)
  } finally {
    await driver.end()
    await usage.dispose()
    await rm(folder, { recursive: true, force: true })
  }
})

test('implements the provider without a host', async () => {
  const provider = create()
  for (const method of ['account', 'program', 'models', 'limits', 'list', 'search', 'hidden', 'create', 'fork', 'has', 'read', 'links', 'goal', 'setGoal', 'clearGoal', 'hold', 'rename', 'remote', 'mcp', 'browsers', 'correct', 'setInstructions', 'delete', 'dispose']) assert.equal(typeof provider[method], 'function', method)
  await provider.setInstructions(true, {})
  assert.equal(provider.instructions, 'own')
})

test('injects text and images into active work without interruption', { skip: !available, timeout: 30000 }, async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'claude-inject-test-')))
  const id = randomUUID()
  const binary = join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs')
  await chmod(binary, 0o755)
  const file = join(folder, 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'), id + '.jsonl')
  const log = join(folder, id + '.log')
  const exists = (path) => stat(path).then(() => true, () => false)
  const events = []
  const host = {
    claudeCommand: () => binary, OFF_PLAN: [],
    planOnly: () => ({ ...process.env, CLAUDE_CONFIG_DIR: folder }),
    claudeState: () => ({}),
    readClaude: () => ({ items: [], gone: [], signals: [] }),
    claudeFile: async () => await exists(file) ? file : undefined,
  }
  let sent = 0
  const driver = holdTmux(host, { id, root: folder, resume: false, mode: 'manual' }, (event) => events.push(event), () => {}, () => { sent += 1 })
  const signals = () => events.flatMap((event) => event.signals)
  const logs = async () => (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  try {
    await assert.rejects(driver.inject('idle'), /no longer working/)
    assert.equal(sent, 0)
    driver.send('hold')
    await until(() => exists(log))
    await until(async () => (await logs()).some((entry) => entry.prompt === 'hold'))
    await delay(600)
    assert.equal(sent, 1, 'ordinary submission counts after Enter')
    const begun = signals().filter((entry) => entry.kind === 'begun').length
    const text = "only this file\n'quoted' $(literal)"
    const delivery = driver.inject(text, [{ media: 'image/png', data: Buffer.from('image bytes').toString('base64') }], ['command output'])
    await assert.rejects(driver.inject('duplicate'), /question/)
    await delivery
    assert.equal(sent, 2, 'only the accepted injection counts')
    await until(async () => (await logs()).some((entry) => entry.injected))
    const accepted = (await logs()).find((entry) => entry.injected).injected
    assert(accepted.startsWith('command output\n\n' + text + '\n\nImage attachment: '), accepted)
    const image = accepted.split('Image attachment: ')[1]
    assert.equal(await readFile(image, 'utf8'), 'image bytes')
    assert.equal(signals().filter((entry) => entry.kind === 'begun').length, begun)
    assert.equal(signals().filter((entry) => entry.kind === 'ended').length, 0)
    assert.equal((await logs()).some((entry) => entry.stopped), false)
    await writeFile(join(folder, id + '.control'), 'release')
    await until(() => signals().some((entry) => entry.kind === 'ended'))
    assert.equal((await logs()).find((entry) => entry.consumed).consumed, accepted)
    assert.equal(await exists(image), false)
    await assert.rejects(driver.inject('finished'), /no longer working/)
    driver.send('permission')
    await until(() => signals().some((entry) => entry.kind === 'asks'))
    const ask = signals().findLast((entry) => entry.kind === 'asks')
    await assert.rejects(driver.inject('do not answer approval'), /question/)
    assert.equal(signals().some((entry) => entry.kind === 'resolved' && entry.ask === ask.ask), false)
    assert.equal((await logs()).some((entry) => entry.choice), false)
    driver.answer(ask.ask, 'No')
    await until(() => signals().filter((entry) => entry.kind === 'ended').length === 2)
    assert.equal(sent, 3, 'question answers and rejected injections do not count')
  } finally {
    await driver.end()
    await rm(folder, { recursive: true, force: true })
  }
})

test('sends through tmux, tails JSONL, and confirms native lifecycle and approvals', { skip: !available, timeout: 50000 }, async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'claude-passive-test-')))
  const id = randomUUID()
  const binary = join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs')
  await chmod(binary, 0o755)
  const file = join(folder, 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'), id + '.jsonl')
  const log = join(folder, id + '.log')
  const exists = (path) => stat(path).then(() => true, () => false)
  const host = {
    claudeCommand: () => binary,
    OFF_PLAN: [],
    planOnly: () => ({ ...process.env, CLAUDE_CONFIG_DIR: folder, CLAUDE_TEST_TRUST: '1', GECKIT_SOURCE_CLI: 'secret-marker' }),
    claudeState: () => ({}),
    readClaude: (_state, entry) => {
      if (entry.type !== 'assistant' || entry.message.model === '<synthetic>') return { items: [], gone: [], signals: [] }
      const text = entry.message.content.filter((part) => part.type === 'text').map((part) => part.text).join('')
      return { items: [{ kind: 'theirs', id: entry.uuid, text }], gone: [], signals: [{ kind: 'said', text }] }
    },
    claudeFile: async () => await exists(file) ? file : undefined,
    sourceArgs: () => { throw new Error('Must not inject source instructions') },
  }
  const heard = []
  let closed = false
  const driver = holdTmux(host, { id, root: folder, resume: true, mode: 'manual' }, (event) => heard.push(event), () => { closed = true })
  const signals = () => heard.flatMap((event) => event.signals)
  const ended = () => signals().filter((one) => one.kind === 'ended')
  const asks = () => signals().filter((one) => one.kind === 'asks')
  const texts = () => heard.flatMap((one) => one.items).filter((one) => one.kind === 'theirs').map((one) => one.text)
  const logs = async () => (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ type: 'assistant', uuid: 'old', message: { content: [{ type: 'text', text: 'old reply' }] } }) + '\n')
    const first = "first\nsecond 'quoted' $(literal) `literal`"
    driver.send(first)
    await until(() => ended().length === 1)
    assert(texts().includes('answer: ' + first), JSON.stringify(texts()))
    assert.equal(texts().includes('old reply'), false)
    assert((await logs()).some((one) => one.ignoredTrustNavigation))
    assert((await logs()).some((one) => one.trusted))
    const launch = (await logs())[0]
    assert(launch.args.includes('--resume'))
    const settings = JSON.parse(launch.args[launch.args.indexOf('--settings') + 1])
    assert.equal(settings.hooks, undefined)
    assert.deepEqual(settings.claudeMdExcludes, [join(folder, 'GECKIT.md')])
    assert.equal(launch.args.includes('--append-system-prompt'), false)
    assert.deepEqual(launch.managed, [])

    driver.send('quiet')
    await delay(1700)
    assert.equal(ended().length, 1, 'idle before observed activity must not finish')
    driver.stop()
    await until(() => ended().length === 2)
    assert.equal(ended().at(-1).how, 'stopped')

    driver.send('hold')
    await delay(1700)
    assert.equal(ended().length, 2, 'silence while working must not finish')
    driver.stop()
    await until(() => ended().length === 3)

    driver.send('unknown')
    await delay(1700)
    assert.equal(ended().length, 3, 'unknown screens must not finish')
    driver.stop()
    await until(() => ended().length === 4)

    driver.send('permission')
    await until(() => asks().length === 1)
    assert.deepEqual(asks()[0].wanted.choices, ['Yes', 'Yes, allow for this session', 'No'])
    driver.answer(asks()[0].ask, 'No')
    await until(() => ended().length === 5)
    assert(texts().includes('choice: No'))

    driver.send('permission stale')
    await until(() => asks().length === 2)
    await writeFile(join(folder, id + '.control'), 'change')
    await until(() => asks().length === 3)
    driver.answer(asks()[1].ask, 'Yes')
    await delay(100)
    assert.equal((await logs()).filter((one) => one.choice === 'Yes').length, 0)
    driver.answer(asks()[2].ask, 'Leave')
    await until(() => ended().length === 6)
    assert(texts().includes('choice: Leave'))

    driver.send('question')
    await until(() => asks().length === 4)
    driver.answer(asks()[3].ask, 'custom answer\nsecond line')
    await until(() => ended().length === 7)
    assert(texts().includes('typed: custom answer\nsecond line'), JSON.stringify(texts()))

    driver.send('partial')
    await delay(1300)
    assert.equal(ended().length, 7, 'incomplete UTF-8 JSONL line must not finish')
    await until(() => ended().length === 8)
    assert(texts().includes('héllo 世界'))

    driver.send('/local')
    await until(() => ended().length === 9)

    driver.send('with image', [{ media: 'image/png', data: Buffer.from('test image').toString('base64') }])
    await until(async () => (await logs()).some((one) => one.prompt?.includes('Image attachment:')))
    const imagePrompt = (await logs()).find((one) => one.prompt?.includes('Image attachment:')).prompt
    const image = imagePrompt.split('Image attachment: ')[1]
    await until(() => ended().length === 10)
    assert.equal(await exists(image), false)

    driver.send('synthetic')
    await until(() => ended().length === 11)
    assert.equal(ended().at(-1).how, 'done', 'benign synthetic placeholders must not fail the turn')
    assert(texts().includes('answer: synthetic'))

    driver.send('api-error')
    await until(() => ended().length === 12)
    assert.equal(ended().at(-1).how, 'failed')
    assert.equal(ended().at(-1).text, 'API Error: rate limit reached')

    driver.send('recovered')
    await until(() => ended().length === 13)
    assert.equal(ended().at(-1).how, 'done', 'a real response clears a recovered API error')

    driver.send('crash')
    await until(() => closed)
    assert.equal(ended().at(-1).how, 'failed')
    assert.equal(ended().at(-1).text, 'Claude Code exited.')
  } finally {
    await driver.end()
    await rm(folder, { recursive: true, force: true })
  }
})
