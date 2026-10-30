import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { holdTmux, terminalScreen } from '../src/provider.mjs'

const fixture = await readFile(new URL('./hook-confirmation.txt', import.meta.url), 'utf8')
const footerless = fixture.replace('Esc to cancel · Tab to amend', '')
const idle = '\n────────────────────\n❯ \n────────────────────\n'
const available = (() => {
  try { execFileSync('tmux', ['-V']); return process.platform !== 'win32' }
  catch { return false }
})()
const until = async (condition) => {
  for (let count = 0; count < 500; count += 1) {
    if (await condition()) return
    await delay(20)
  }
  throw new Error('Timed out waiting for hook confirmation.')
}

test('shows a hook confirmation with its full explanation even without the footer', () => {
  const bordered = footerless.replace(/^Hook PreToolUse:/m, '│ Hook PreToolUse:')
  for (const text of [fixture, footerless, bordered]) {
    const screen = terminalScreen(text)
    assert.equal(screen.kind, 'question')
    assert.deepEqual(screen.options.map((option) => option.label), ['Yes', 'No'])
    assert(screen.title.includes('Hook PreToolUse:Bash requires confirmation'))
    assert(screen.title.includes('own-english:'))
    assert(screen.title.includes('FLAG contractions'))
    assert(screen.title.endsWith('Do you want to proceed?'))
    assert.equal(terminalScreen(text.replace('❯ 1.', '  1.').replace('  2. No', '❯ 2. No')).focus, 1)
  }
})

test('does not revive quoted, incomplete or obsolete hook confirmations', () => {
  assert.equal(terminalScreen(footerless + idle).kind, 'idle')
  assert.equal(terminalScreen(fixture + idle).kind, 'idle')
  assert.equal(terminalScreen(footerless.replace('  2. No', '')).kind, 'unknown')
  assert.equal(terminalScreen(footerless.replace('Hook PreToolUse:Bash requires confirmation for this command:', 'Example of a dialog:')).kind, 'unknown')
  assert.equal(terminalScreen(footerless + '\n✶ Working…').kind, 'working')
  assert.equal(terminalScreen('Do you want to proceed?\n❯ 1. Yes\n  2. No').kind, 'unknown')
  const later = terminalScreen(fixture + '\nNew question?\n❯ 1. Stay\n  2. Leave\nEnter to select · Esc to cancel')
  assert.equal(later.kind, 'question')
  assert.deepEqual(later.options.map((option) => option.label), ['Stay', 'Leave'])
})

test('delivers hook Yes/No through the existing card and waits for explicit input', { skip: !available, timeout: 30000 }, async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'claude-hook-confirmation-')))
  const binary = new URL('./fake-claude.mjs', import.meta.url).pathname
  await chmod(binary, 0o755)
  const id = randomUUID()
  const events = []
  const driver = holdTmux({
    claudeCommand: () => binary, OFF_PLAN: [],
    planOnly: () => ({ ...process.env, CLAUDE_CONFIG_DIR: folder }),
    claudeState: () => ({}), claudeFile: async () => undefined,
  }, { id, root: folder, mode: 'auto' }, (event) => events.push(event), () => {})
  const signals = () => events.flatMap((event) => event.signals)
  const asks = () => signals().filter((signal) => signal.kind === 'asks')
  const ended = () => signals().filter((signal) => signal.kind === 'ended')
  const choices = async () => (await readFile(join(folder, id + '.log'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((line) => line.choice)
  try {
    for (const [index, answer] of ['Yes', 'No'].entries()) {
      driver.send('hook-confirmation')
      await until(() => asks().length === index + 1)
      const ask = asks().at(-1)
      assert.equal(ask.wanted.kind, 'question')
      assert.deepEqual(ask.wanted.choices, ['Yes', 'No'])
      assert(ask.wanted.question.includes('own-english:'))
      await delay(700)
      assert.equal((await choices()).length, index)
      await assert.rejects(driver.inject('continue'), /question/)
      driver.answer(ask.ask, answer)
      await until(() => ended().length === index + 1)
      assert.equal((await choices()).at(-1).choice, answer)
      assert.equal(ended().at(-1).how, 'done')
    }
  } finally {
    await driver.end()
    await rm(folder, { recursive: true, force: true })
  }
})


const countdown = (time, action = 'deny') => `────────────────────
rc=$?; grep -E "will be|must be|Plan:|Error" plan-openai.log | head -40
────────────────────
Dangerous rm operation not ruled out — the shell may read this command differently than it was parsed
⚠ Claude Code will automatically ${action} this request in ${time}, to avoid
blocking progress on an unattended session
Do you want to proceed?
❯ 1. Yes
  2. No
Esc to cancel`

for (const action of ['deny', 'block']) test(`keeps automatic-${action} countdown ticks out of question identity and wording`, () => {
  const first = terminalScreen(countdown('0:05', action))
  assert.equal(first.kind, 'question')
  assert(first.title.includes('Dangerous rm operation not ruled out'))
  assert(first.title.includes(`Claude Code will automatically ${action} this request, to avoid`))
  assert(!first.title.includes('0:05'))
  for (const time of ['0:04', '0:00', '1:00', '10:00']) {
    const next = terminalScreen(countdown(time, action))
    assert.equal(next.signature, first.signature)
    assert.equal(next.title, first.title)
  }
  const wrapped = terminalScreen(countdown('0:04', action).replace('request in 0:04,', 'request in\n0:04,'))
  assert.equal(wrapped.signature, first.signature)
  assert.notEqual(terminalScreen(countdown('0:04', action).replace('not ruled out', 'detected')).signature, first.signature)
  assert.notEqual(terminalScreen(countdown('0:04', action).replace('2. No', '2. Cancel')).signature, first.signature)
  assert.equal(terminalScreen(countdown('0:00', action) + idle).kind, 'idle')
  const other = terminalScreen('Retry after 0:05?\n❯ 1. Yes\n  2. No\nEsc to cancel')
  assert(other.title.includes('0:05'))
})


for (const action of ['deny', 'block']) test(`keeps one card across ${action} countdown ticks and still rejects genuinely stale answers`, { skip: !available, timeout: 30000 }, async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'claude-countdown-')))
  const binary = new URL('./fake-claude.mjs', import.meta.url).pathname
  const id = randomUUID()
  const events = []
  const driver = holdTmux({
    claudeCommand: () => binary, OFF_PLAN: [],
    planOnly: () => ({ ...process.env, CLAUDE_CONFIG_DIR: folder }),
    claudeState: () => ({}), claudeFile: async () => undefined,
  }, { id, root: folder, mode: 'auto' }, (event) => events.push(event), () => {})
  const signals = () => events.flatMap((event) => event.signals)
  const asks = () => signals().filter((signal) => signal.kind === 'asks')
  const ended = () => signals().filter((signal) => signal.kind === 'ended')
  const logs = async () => (await readFile(join(folder, id + '.log'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  const control = (text) => writeFile(join(folder, id + '.control'), text)
  try {
    for (const [index, answer] of ['Yes', 'No'].entries()) {
      driver.send(`countdown-${action}-confirmation`)
      await until(() => asks().length === index + 1)
      const ask = asks().at(-1)
      await control('countdown-tick')
      await until(async () => (await logs()).filter((line) => line.countdownTick).length === index + 1)
      await delay(1200)
      assert.equal(asks().length, index + 1, 'timer tick does not replace the card')
      assert.equal(signals().filter((signal) => signal.kind === 'resolved').length, 0)
      assert.equal((await logs()).filter((line) => line.choice).length, index, 'no automatic answer')
      await assert.rejects(driver.inject('continue'), /question/)
      driver.answer(ask.ask, answer)
      await until(() => ended().length === index + 1)
      assert.equal((await logs()).filter((line) => line.choice).at(-1).choice, answer)
      assert.equal(ended().at(-1).how, 'done')
    }
    driver.send(`countdown-${action}-confirmation`)
    await until(() => asks().length === 3)
    const stale = asks().at(-1)
    await control('change')
    await until(() => asks().length === 4)
    driver.answer(stale.ask, 'Yes')
    await delay(600)
    assert.equal((await logs()).filter((line) => line.choice).length, 2)
    driver.answer(asks().at(-1).ask, 'Leave')
    await until(() => ended().length === 3)
    assert.equal((await logs()).filter((line) => line.choice).at(-1).choice, 'Leave')
    driver.send(`countdown-${action}-confirmation`)
    await until(() => asks().length === 5)
    const expired = asks().at(-1)
    await control('countdown-expire')
    await until(() => signals().some((signal) => signal.kind === 'resolved' && signal.ask === expired.ask))
    await until(() => ended().length === 4)
    driver.answer(expired.ask, 'Yes')
    await delay(200)
    assert.equal((await logs()).filter((line) => line.choice).length, 3)
  } finally {
    await driver.end()
    await rm(folder, { recursive: true, force: true })
  }
})
