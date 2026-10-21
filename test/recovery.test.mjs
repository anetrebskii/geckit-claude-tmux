import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { holdTmux, terminalScreen } from '../index.mjs'
import { claudeState, readClaude } from '../src/claude-runtime.mjs'
const binary = (() => { try { return process.platform === 'win32' ? undefined : execFileSync('which', ['tmux'], { encoding: 'utf8' }).trim() } catch { return undefined } })()
const until = async (condition) => {
  for (let i = 0; i < 500; i++) { if (await condition()) return; await delay(20) }
  throw new Error('Timed out')
}
async function fixture(failures, startupDelay = 0, resume = false, startupMcp = false) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'tmux-recovery-')))
  const id = randomUUID()
  const server = 'recovery-' + id
  const command = join(folder, 'claude.mjs')
  await writeFile(command, `#!/usr/bin/env node\nimport {appendFileSync,existsSync,readFileSync} from 'node:fs';\nconst file=${JSON.stringify(join(folder, 'starts'))};\nconst n=existsSync(file)?readFileSync(file,'utf8').length:0;\nappendFileSync(file,'x');\nawait new Promise(resolve=>setTimeout(resolve,${startupDelay}));\nif(n<${failures} || ${resume}) {console.error(${JSON.stringify(resume ? 'No conversation found with session ID: ' + id : 'Startup failed: test launch failure')});process.exit(17)}\nawait import(${JSON.stringify(new URL('./fake-claude.mjs', import.meta.url).href)});\n`, { mode: 0o755 })
  const events = [], logs = []
  let closed = 0
  const file = join(folder, 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'), id + '.jsonl')
  const runtime = { tmux: async () => ({ file: binary, server: ['-L', server] }), claudeCommand: () => command, OFF_PLAN: [], planOnly: () => ({ ...process.env, CLAUDE_CONFIG_DIR: folder, ...startupMcp ? { CLAUDE_TEST_MCP: '1' } : {} }), claudeState, readClaude, claudeFile: () => stat(file).then(() => file, () => undefined) }
  const driver = holdTmux(runtime, { id, root: folder, mode: 'manual', resume }, (e) => events.push(e), () => closed++, () => {}, (level, event, fields) => logs.push({ level, event, fields }))
  return { folder, id, driver, logs, events, kill: () => execFileSync(binary, ['-L', server, 'kill-session', '-t', execFileSync(binary, ['-L', server, 'list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' }).trim()]), ended: () => events.flatMap(e => e.signals).filter(s => s.kind === 'ended'), closed: () => closed, starts: async () => (await readFile(join(folder, 'starts'), 'utf8')).length, cleanup: async () => { await driver.end(); try { execFileSync(binary, ['-L', server, 'kill-server'], { stdio: 'ignore' }) } catch {} await rm(folder, { recursive: true, force: true }) } }
}
test('recovers one startup exit before typing and submits the original message once', { skip: binary === undefined, timeout: 15000 }, async () => {
 const f = await fixture(1)
 try {
  f.driver.send('hello')
  await until(() => f.ended().length > 0)
  assert.equal(f.ended()[0].how, 'done')
  assert.equal(await f.starts(), 2)
  const entries = (await readFile(join(f.folder, f.id + '.log'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.deepEqual(entries.filter(e => e.prompt).map(e => e.prompt), ['hello'])
  assert(!entries[0].args.includes('--resume'))
  assert.equal(f.closed(), 0)
 } finally { await f.cleanup() }
})
test('bounds startup recovery and retains the native exit diagnostic', { skip: binary === undefined, timeout: 15000 }, async () => {
 const f = await fixture(9)
 try {
  f.driver.send('hello')
  await until(() => f.closed() > 0)
  assert.equal(await f.starts(), 2)
  assert.equal(f.ended().length, 1)
  assert.equal(f.ended()[0].how, 'failed')
  assert.match(f.ended()[0].text, /Startup failed: test launch failure/)
  assert(!f.ended()[0].text.includes("can't find pane"))
 } finally { await f.cleanup() }
})
test('never automatically replays a message after native submission', { skip: binary === undefined, timeout: 15000 }, async () => {
 const f = await fixture(0)
 try {
  f.driver.send('crash')
  await until(() => f.closed() > 0)
  assert.equal(await f.starts(), 1)
  assert.equal(f.ended().length, 1)
  assert.equal(f.ended()[0].how, 'failed')
 } finally { await f.cleanup() }
})

test('recreates a vanished idle pane and resumes saved history for the next message', { skip: binary === undefined, timeout: 15000 }, async () => {
 const f = await fixture(0)
 try {
  f.driver.send('first')
  await until(() => f.ended().length === 1)
  f.kill()
  f.driver.send('second')
  await until(() => f.ended().length === 2)
  assert.deepEqual(f.ended().map(e => e.how), ['done', 'done'])
  const entries = (await readFile(join(f.folder, f.id + '.log'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.deepEqual(entries.filter(e => e.prompt).map(e => e.prompt), ['first', 'second'])
  const launches = entries.filter(e => e.args)
  assert.equal(launches.length, 2)
  assert.equal(launches[1].args[launches[1].args.indexOf('--resume') + 1], f.id)
  assert.equal(f.closed(), 0)
 } finally { await f.cleanup() }
})
test('Stop during startup prevents recovery and later message submission', { skip: binary === undefined, timeout: 15000 }, async () => {
 const f = await fixture(1, 700)
 try {
  f.driver.send('hello')
  await until(async () => await f.starts().catch(() => 0) === 1)
  f.driver.stop()
  await until(() => f.closed() > 0)
  assert.equal(await f.starts(), 1)
  assert.deepEqual(f.ended().map(e => e.how), ['stopped'])
 } finally { await f.cleanup() }
})

test('missing resumed history remains a failed resume, never an empty new conversation', { skip: binary === undefined, timeout: 15000 }, async () => {
 const f = await fixture(0, 0, true)
 try {
  f.driver.send('continue')
  await until(() => f.closed() > 0)
  assert.equal(await f.starts(), 2)
  assert.match(f.ended()[0].text, /No conversation found with session ID:/)
  await assert.rejects(readFile(join(f.folder, f.id + '.log')), { code: 'ENOENT' })
 } finally { await f.cleanup() }
})

const startupScreen = `────────────────────
  2 new MCP servers found in this project
  Select any you wish to enable.

  MCP servers may execute code or access system resources. All tool calls require approval. Learn more in the MCP documentation.

  ❯ [✔] linear-formula
    [✔] notion-formula
       Enable selected
 Space to select · Esc to reject all

`
test('recognizes discovered MCP servers and native keyboard actions without treating history as a live menu', () => {
 const screen = terminalScreen(startupScreen)
 assert.equal(screen.kind, 'question')
 assert.equal(screen.focus, 0)
 assert.deepEqual(screen.options, [{ label: '[✔] linear-formula', key: 'Space' }, { label: '[✔] notion-formula', key: 'Space' }, { label: 'Enable selected', key: 'Enter' }, { label: 'Reject all', key: 'Escape' }])
 assert(screen.title.includes('All tool calls require approval.'))
 assert.equal(terminalScreen(startupScreen.replace('  ❯ [✔]', '    [✔]').replace('       Enable selected', '  ❯    Enable selected')).focus, 2)
 assert.equal(terminalScreen(startupScreen + '────────────────────\n❯ \n────────────────────\n').kind, 'idle')
 assert.equal(terminalScreen(startupScreen.replace('Space to select · Esc to reject all', '')).kind, 'unknown')
})
for (const action of ['Enable selected', 'Reject all']) {
 test(`startup MCP question waits for explicit selection, then ${action} and sends original input once`, { skip: binary === undefined, timeout: 100000 }, async () => {
  const f = await fixture(0, 0, false, true)
  const asks = () => f.events.flatMap(e => e.signals).filter(s => s.kind === 'asks')
  const log = async () => (await readFile(join(f.folder, f.id + '.log'), 'utf8')).trim().split('\n').map(JSON.parse)
  try {
   f.driver.send('original message')
   await until(() => asks().length === 1)
   await delay(action === 'Enable selected' ? 65000 : 1000)
   assert.equal(f.ended().length, 0, 'waiting for a person must not exhaust startup readiness')
   assert.equal(asks().length, 1)
   assert.equal((await log()).some(e => e.prompt || e.mcpEnabled || e.mcpRejected), false)
   const old = asks()[0].ask
   f.driver.answer(old, '[✔] linear-formula')
   await until(() => asks().length === 2)
   assert(asks().at(-1).wanted.choices.includes('[ ] linear-formula'))
   f.driver.answer(old, 'Enable selected')
   await delay(200)
   assert.equal((await log()).some(e => e.mcpEnabled), false)
   f.driver.answer(asks().at(-1).ask, action)
   await until(() => f.ended().length === 1)
   assert.equal(f.ended()[0].how, 'done')
   const rows = await log()
   assert.deepEqual(rows.filter(e => e.prompt).map(e => e.prompt), ['original message'])
   if (action === 'Enable selected') assert.deepEqual(rows.find(e => e.mcpEnabled).mcpEnabled, [1])
   else assert.equal(rows.filter(e => e.mcpRejected).length, 1)
   assert.equal(await f.starts(), 1)
   assert(f.events.flatMap(e => e.signals).some(s => s.kind === 'resolved' && s.ask === asks().at(-1).ask))
  } finally { await f.cleanup() }
 })
}
test('Stop while a startup MCP question waits resolves the card and never submits input', { skip: binary === undefined, timeout: 15000 }, async () => {
 const f = await fixture(0, 0, false, true)
 try {
  f.driver.send('must stay unsent')
  await until(() => f.events.flatMap(e => e.signals).some(s => s.kind === 'asks'))
  f.driver.stop()
  await until(() => f.closed() > 0)
  assert.deepEqual(f.ended().map(e => e.how), ['stopped'])
  const log = (await readFile(join(f.folder, f.id + '.log'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(log.some(e => e.prompt || e.mcpEnabled || e.mcpRejected), false)
  assert(f.events.flatMap(e => e.signals).some(s => s.kind === 'resolved'))
 } finally { await f.cleanup() }
})
