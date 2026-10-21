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
  throw new Error('Timed out waiting for input delivery')
}
async function fixture(id = randomUUID()) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'tmux-input-')))
  const server = 'input-' + randomUUID()
  const wrapper = join(folder, 'tmux.mjs'), commandLog = join(folder, 'commands.jsonl')
  await writeFile(wrapper, `#!${process.execPath}\nimport {appendFileSync,existsSync} from 'node:fs';import {spawnSync} from 'node:child_process';const args=process.argv.slice(2);appendFileSync(${JSON.stringify(commandLog)},JSON.stringify(args)+'\\n');if(args.includes('paste-buffer')&&existsSync(${JSON.stringify(join(folder, 'fail-paste'))})){console.error('Test paste failure');process.exit(1)}const p=spawnSync(${JSON.stringify(binary)},args,{stdio:'inherit'});process.exit(p.status??1);\n`, { mode: 0o755 })
  const file = join(folder, 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'), id + '.jsonl')
  const events = [], sent = []
  const driver = holdTmux({ tmux: async () => ({ file: wrapper, server: ['-L', server] }), claudeCommand: () => new URL('./fake-claude.mjs', import.meta.url).pathname, OFF_PLAN: [], planOnly: () => ({ ...process.env, CLAUDE_CONFIG_DIR: folder }), claudeState, readClaude, claudeFile: () => stat(file).then(() => file, () => undefined) }, { id, root: folder, mode: 'manual' }, (event) => events.push(event), () => {}, (kind) => sent.push(kind))
  const rows = async (file) => (await readFile(file, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse)
  return { folder, driver, sent, logs: () => rows(join(folder, id + '.log')), commands: () => rows(commandLog), ended: () => events.flatMap(e => e.signals).filter(s => s.kind === 'ended'), asks: () => events.flatMap(e => e.signals).filter(s => s.kind === 'asks'), buffers: () => { try { return execFileSync(binary, ['-L', server, 'list-buffers'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' } }, cleanup: async () => { await driver.end(); try { execFileSync(binary, ['-L', server, 'kill-server'], { stdio: 'ignore' }) } catch {} await rm(folder, { recursive: true, force: true }) } }
}

test('types through 80 Unicode characters, then types a 12-character prefix and pastes exact multiline input', { skip: binary === undefined, timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    const short = '🙂'.repeat(80)
    f.driver.send(short)
    await until(() => f.ended().length === 1)
    assert.equal((await f.logs()).some(e => e.pasteStarted !== undefined), false)
    const boundary = '界'.repeat(81)
    f.driver.send(boundary)
    await until(() => f.ended().length === 2)
    const long = '🙂Start\n世界abc\n' + 'line \\ "quoted" $literal\n'.repeat(500) + '\n'
    const started = Date.now()
    f.driver.send(long)
    await until(() => f.ended().length === 3)
    assert(Date.now() - started < 7000, 'long input must not incur a delay per character')
    const log = await f.logs()
    assert.deepEqual(log.filter(e => e.prompt !== undefined).map(e => e.prompt), [short, boundary, long])
    assert.deepEqual(log.filter(e => e.pasteStarted !== undefined).map(e => e.pasteStarted), [Array.from(boundary).slice(0, 12).join(''), Array.from(long).slice(0, 12).join('')])
    assert.deepEqual(log.filter(e => e.pasteEnded !== undefined).map(e => e.pasteEnded), [boundary, long])
    assert.deepEqual(f.ended().map(e => e.how), ['done', 'done', 'done'])
    assert.equal(f.buffers(), '')
    assert.deepEqual(f.sent, ['send', 'send', 'send'])
  } finally { await f.cleanup() }
})

test('pastes long Send now and checkbox custom input without premature submission', { skip: binary === undefined, timeout: 30000 }, async () => {
  const f = await fixture()
  try {
    f.driver.send('hold')
    await until(async () => (await f.logs()).some(e => e.prompt === 'hold'))
    const text = 'Guidance\n' + '界🙂 long text\n'.repeat(50)
    await f.driver.inject(text)
    await until(async () => (await f.logs()).some(e => e.injected === text))
    assert.deepEqual(f.sent, ['send', 'inject'])
    assert.equal((await f.logs()).filter(e => e.injected).length, 1)
    f.driver.stop()
    await until(() => f.ended().length === 1)
    f.driver.send('checkbox')
    await until(() => f.asks().length > 0)
    const answer = 'Custom schedule ' + 'every Monday 🙂 '.repeat(20)
    f.driver.answer(f.asks().at(-1).ask, answer)
    await until(async () => (await f.logs()).some(e => e.submitted))
    assert.deepEqual((await f.logs()).find(e => e.submitted).submitted, [answer])
    assert.equal((await f.logs()).filter(e => e.submitted).length, 1)
    await until(() => f.asks().at(-1).wanted.choices.includes('Submit answers'))
    f.driver.answer(f.asks().at(-1).ask, 'Submit answers')
    await until(() => f.ended().length === 2)
    assert.equal(f.ended()[1].how, 'done')
    assert.equal(f.buffers(), '')
  } finally { await f.cleanup() }
})

test('failed Send now paste retains rejection, clears partial input and removes its tmux buffer', { skip: binary === undefined, timeout: 15000 }, async () => {
  const f = await fixture()
  try {
    f.driver.send('hold')
    await until(async () => (await f.logs()).some(e => e.prompt === 'hold'))
    await writeFile(join(f.folder, 'fail-paste'), '')
    await assert.rejects(f.driver.inject('long guidance '.repeat(20)), /Test paste failure/)
    await until(async () => (await f.logs()).some(e => e.clearedInput))
    assert.equal(f.buffers(), '')
    assert.equal((await f.logs()).some(e => e.injected), false)
    assert.deepEqual(f.sent, ['send'])
  } finally { await f.cleanup() }
})

test('Stop during the typed prefix prevents long input from being pasted or submitted', { skip: binary === undefined, timeout: 15000 }, async () => {
  const f = await fixture()
  try {
    f.driver.send('long message '.repeat(100))
    await until(async () => (await f.commands()).some(args => args.includes('send-keys') && args.includes('-l')))
    f.driver.stop()
    await until(() => f.ended().length === 1)
    assert.equal(f.ended()[0].how, 'stopped')
    assert.equal((await f.logs()).some(e => e.prompt || e.pasteStarted !== undefined), false)
    assert.deepEqual(f.sent, [])
    assert.equal(f.buffers(), '')
  } finally { await f.cleanup() }
})

test('question IDs remain unique when a new driver resumes the same conversation', { skip: binary === undefined, timeout: 20000 }, async () => {
  const id = randomUUID()
  const first = await fixture(id)
  let old
  try {
    first.driver.send('question')
    await until(() => first.asks().length === 1)
    old = first.asks()[0].ask
  } finally { await first.cleanup() }
  const next = await fixture(id)
  try {
    next.driver.send('question')
    await until(() => next.asks().length === 1)
    const current = next.asks()[0].ask
    assert.notEqual(current, old, 'a resumed driver must not overwrite an earlier question card')
    await delay(700)
    assert.equal(next.asks().length, 1, 'unchanged menu polling must keep the same question')
    next.driver.answer(old, 'A')
    await delay(700)
    assert.equal((await next.logs()).filter(entry => entry.choice).length, 0, 'stale answers must not reach the new native menu')
    next.driver.answer(current, 'B')
    await until(() => next.ended().length === 1)
    assert.deepEqual((await next.logs()).filter(entry => entry.choice).map(entry => entry.choice), ['B'])
  } finally { await next.cleanup() }
})
