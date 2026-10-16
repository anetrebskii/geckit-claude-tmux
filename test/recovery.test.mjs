import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { holdTmux } from '../index.mjs'
import { claudeState, readClaude } from '../src/claude-runtime.mjs'
const binary = (() => { try { return process.platform === 'win32' ? undefined : execFileSync('which', ['tmux'], { encoding: 'utf8' }).trim() } catch { return undefined } })()
const until = async (condition) => {
  for (let i = 0; i < 500; i++) { if (await condition()) return; await delay(20) }
  throw new Error('Timed out')
}
async function fixture(failures, startupDelay = 0, resume = false) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'tmux-recovery-')))
  const id = randomUUID()
  const server = 'recovery-' + id
  const command = join(folder, 'claude.mjs')
  await writeFile(command, `#!/usr/bin/env node\nimport {appendFileSync,existsSync,readFileSync} from 'node:fs';\nconst file=${JSON.stringify(join(folder, 'starts'))};\nconst n=existsSync(file)?readFileSync(file,'utf8').length:0;\nappendFileSync(file,'x');\nawait new Promise(resolve=>setTimeout(resolve,${startupDelay}));\nif(n<${failures} || ${resume}) {console.error(${JSON.stringify(resume ? 'No conversation found with session ID: ' + id : 'Startup failed: test launch failure')});process.exit(17)}\nawait import(${JSON.stringify(new URL('./fake-claude.mjs', import.meta.url).href)});\n`, { mode: 0o755 })
  const events = [], logs = []
  let closed = 0
  const file = join(folder, 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'), id + '.jsonl')
  const runtime = { tmux: async () => ({ file: binary, server: ['-L', server] }), claudeCommand: () => command, OFF_PLAN: [], planOnly: () => ({ ...process.env, CLAUDE_CONFIG_DIR: folder }), claudeState, readClaude, claudeFile: () => stat(file).then(() => file, () => undefined) }
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
