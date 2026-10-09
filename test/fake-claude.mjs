#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const id = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1]
const dir = join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'))
mkdirSync(dir, { recursive: true })
const file = join(dir, id + '.jsonl')
const log = join(process.env.CLAUDE_CONFIG_DIR, id + '.log')
const record = (value) => appendFileSync(log, JSON.stringify(value) + '\n')
record({ args, managed: Object.keys(process.env).filter((key) => key.startsWith('GECKIT_')) })
const write = (entry) => appendFileSync(file, JSON.stringify(entry) + '\n')
let count = 0
let selection = 0
let menu
let timer
let input = ''
let busy = false
const queued = []
let pasting = false
let typed = false
let trusting = Boolean(process.env.CLAUDE_TEST_TRUST)
let trustFocus = 0
let trustMissed = false
const trustScreen = () => paint(`Quick safety check:\nIs this a project you created or one you trust?\n${trustFocus === 0 ? "❯" : " "} No, exit\n${trustFocus === 1 ? "❯" : " "} Yes, I trust this folder\nEnter to confirm`)
const paint = (text) => process.stdout.write('\x1b[2J\x1b[H' + text)
const idle = () => { busy = false; paint('Claude Code\n────────────────────\n❯\u00a0Try "ask anything"\n────────────────────\n  auto mode on\n') }
const working = () => { busy = true; paint('Claude Code\n✶ Working…\n────────────────────\n❯\u00a0\n────────────────────\n') }
const choices = () => paint(`${menu.title}\n${menu.options.map((label, i) => `${i === selection ? '❯' : ' '} ${i + 1}. ${label}`).join('\n')}\n  Enter to select · Esc to cancel\n`)
const reply = (text) => {
  write({ type: 'assistant', uuid: 'reply-' + ++count, message: { model: 'claude-test', stop_reason: 'end_turn', content: [{ type: 'text', text }] } })
  idle()
}
const say = (prompt) => {
  record({ prompt })
  if (prompt === 'crash') process.exit(1)
  if (prompt === 'quiet') { idle(); return }
  if (prompt === '/local') {
    write({ type: 'system', subtype: 'local_command', isMeta: true, commandRun: '/local', content: 'Local result' })
    idle(); return
  }
  working()
  if (prompt === 'hold') return
  if (['synthetic', 'api-error', 'recovered'].includes(prompt)) {
    write({ type: 'assistant', uuid: 'synthetic-' + ++count, isApiErrorMessage: prompt !== 'synthetic', message: { model: '<synthetic>', stop_reason: 'stop_sequence', content: [{ type: 'text', text: prompt === 'synthetic' ? 'No response requested.' : 'API Error: rate limit reached' }] } })
    if (prompt === 'api-error') { idle(); return }
    timer = setTimeout(() => reply('answer: ' + prompt), 100)
    return
  }
  if (prompt === 'unknown') { paint('Unrecognized terminal state\n'); return }
  if (prompt.startsWith('permission') || prompt === 'question') {
    menu = prompt === 'question' ? { title: 'Which option?', options: ['A', 'B', 'Type something.'] } : { title: 'Run command?\nnpm test', options: ['Yes', 'Yes, allow for this session', 'No'] }
    selection = 0
    choices(); return
  }
  if (prompt === 'partial') {
    const bytes = Buffer.from(JSON.stringify({ type: 'assistant', uuid: 'partial', message: { model: 'claude-test', content: [{ type: 'text', text: 'héllo 世界' }] } }) + '\n')
    const cut = bytes.indexOf(Buffer.from('世界')) + 1
    appendFileSync(file, bytes.subarray(0, cut))
    idle()
    timer = setTimeout(() => appendFileSync(file, bytes.subarray(cut)), 1800)
    return
  }
  timer = setTimeout(() => reply('answer: ' + prompt), 100)
}
process.stdin.setRawMode(true)
process.stdout.write('\x1b[?2004h')
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  for (let i = 0; i < chunk.length; i += 1) {
    if (chunk.slice(i).startsWith('\x1b[200~')) { pasting = true; i += 5; continue }
    if (chunk.slice(i).startsWith('\x1b[201~')) { pasting = false; i += 5; continue }
    if (chunk.slice(i).startsWith('\x1b[A') || chunk.slice(i).startsWith('\x1b[B')) {
      if (trusting) {
        if (!trustMissed) { trustMissed = true; record({ ignoredTrustNavigation: true }) }
        else { trustFocus = chunk[i + 2] === 'B' ? 1 : 0; trustScreen() }
      }
      if (menu) { selection = Math.max(0, Math.min(menu.options.length - 1, selection + (chunk[i + 2] === 'A' ? -1 : 1))); choices() }
      i += 2; continue
    }
    const c = chunk[i]
    if (c === '\x03') { clearTimeout(timer); queued.length = 0; menu = undefined; record({ stopped: true }); idle(); continue }
    if (c === '\x15') { input = ''; record({ clearedInput: true }); continue }
    if ((c === '\r' || c === '\n') && !pasting) {
      if (input.endsWith('\\')) { input = input.slice(0, -1) + '\n'; continue }
      if (trusting) { if (trustFocus !== 1) process.exit(1); trusting = false; record({ trusted: true }); idle(); continue }
      if (menu) {
        const choice = menu.options[selection]
        record({ choice })
        menu = undefined
        if (choice === 'Type something.') { typed = true; paint('Type your answer\n'); continue }
        reply('choice: ' + choice)
      } else if (typed) { typed = false; reply('typed: ' + input); input = '' }
      else { const prompt = input; input = ''; if (busy) { queued.push(prompt); record({ injected: prompt }) } else say(prompt) }
    } else input += pasting && c === '\r' ? '\n' : c
  }
})
setInterval(() => {
  const control = join(process.env.CLAUDE_CONFIG_DIR, id + '.control')
  let command
  try { command = readFileSync(control, 'utf8') } catch { return }
  if (!command) return
  writeFileSync(control, '')
  if (command === 'change' && menu) { menu = { title: 'New question', options: ['Stay', 'Leave'] }; selection = 0; choices() }
  if (command === 'release' && busy && queued.length > 0) { record({ consumed: queued.shift() }); reply('injection consumed') }
}, 40)
if (process.env.CLAUDE_TEST_TRUST) {
  trustScreen()
} else idle()
