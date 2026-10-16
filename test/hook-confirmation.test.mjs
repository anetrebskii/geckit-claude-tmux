import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
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
