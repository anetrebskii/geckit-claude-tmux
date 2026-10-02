import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import { holdTmux } from '../index.mjs'

const available = (() => {
  try { execFileSync('tmux', ['-V']); return process.platform !== 'win32' }
  catch { return false }
})()

const until = async (condition) => {
  for (let count = 0; count < 500; count += 1) {
    if (condition()) return
    await delay(20)
  }
  throw new Error('Timed out waiting for Claude Code.')
}

test('resumes a session, streams transcript and hook output, and answers permissions', { skip: !available }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'geckit-tmux-plugin-'))
  const previousPath = process.env.PATH
  const previousConfig = process.env.CLAUDE_CONFIG_DIR
  try {
    const binary = join(folder, 'claude')
    await writeFile(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const id = args[args.indexOf('--resume') + 1];
const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
const root = process.cwd();
const dir = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', root.replace(/[^A-Za-z0-9]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, id + '.jsonl');
async function hook(event, extra) {
  const target = settings.hooks[event][0].hooks[0];
  const response = await fetch(target.url, { method: 'POST', headers: { ...target.headers, 'content-type': 'application/json' }, body: JSON.stringify({ session_id: id, hook_event_name: event, ...extra }) });
  return response.json();
}
let count = 0;
async function say(prompt) {
  count += 1;
  await hook('UserPromptSubmit', { prompt });
  if (count === 2) {
    const choice = await hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
    if (choice.hookSpecificOutput.decision.behavior !== 'allow') throw new Error('permission denied');
  }
  if (count === 3) {
    const choice = await hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which option?', header: 'Option', options: [{ label: 'A' }, { label: 'B' }] }] } });
    if (choice.hookSpecificOutput.updatedInput.answers['Which option?'] !== 'B') throw new Error('question unanswered');
  }
  const answer = 'answer ' + count;
  await hook('MessageDisplay', { message_id: 'display-' + count, index: 0, delta: answer });
  fs.appendFileSync(file, JSON.stringify({ type: 'assistant', uuid: 'reply-' + count, timestamp: new Date().toISOString(), message: { model: 'claude-test', content: [{ type: 'text', text: answer }], stop_reason: 'end_turn' } }) + '\\n');
  await hook('Stop', { last_assistant_message: answer });
}
void say(args.at(-1));
process.stdin.setEncoding('utf8');
let pending = '';
process.stdin.on('data', (chunk) => {
  pending += chunk;
  const at = pending.indexOf('\\n');
  if (at < 0) return;
  const prompt = pending.slice(0, at).replace(/\\r$/, '');
  pending = pending.slice(at + 1);
  void say(prompt);
});
`)
    await chmod(binary, 0o755)
    process.env.PATH = `${folder}:${previousPath ?? ''}`
    process.env.CLAUDE_CONFIG_DIR = folder
    const id = randomUUID()
    const host = {
      claudeCommand: () => binary,
      offPlan: [],
      planOnly: () => ({ ...process.env }),
      claudeState: () => ({}),
      readClaude: (_state, entry) => {
        if (entry.type !== 'assistant') return { items: [], gone: [], signals: [] }
        const text = entry.message.content.filter((part) => part.type === 'text').map((part) => part.text).join('')
        return { items: [{ kind: 'theirs', id: entry.uuid, text }], gone: [], signals: [{ kind: 'said', text }] }
      },
      claudeFile: async (root, session) => {
        for (const pathRoot of [root, await realpath(root)]) {
          const path = join(folder, 'projects', pathRoot.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`)
          if (await stat(path).then(() => true, () => false)) return path
        }
        return undefined
      },
      sourceArgs: () => [],
      askId: (ask, index) => index === 0 ? ask : `${ask}#${index}`,
      questionsFromClaude: (input) => (input.questions ?? []).map((one) => ({ kind: 'question', question: one.question })),
      wantedFromClaude: () => ({ kind: 'permission', title: 'Allow command' }),
    }
    const heard = []
    const driver = holdTmux(host, { id, root: folder, resume: true, mode: 'manual' }, (event) => heard.push(event), () => undefined)
    const signals = () => heard.flatMap((event) => event.signals)
    try {
      driver.send('first')
      await until(() => signals().filter((one) => one.kind === 'ended').length === 1)
      assert(heard.flatMap((one) => one.items).some((one) => one.kind === 'theirs' && one.text === 'answer 1'), JSON.stringify(heard))
      assert(heard.flatMap((one) => one.gone).includes('tmux:message:display-1'), JSON.stringify(heard))
      driver.send('second')
      await until(() => signals().some((one) => one.kind === 'asks'))
      driver.answer(signals().find((one) => one.kind === 'asks').ask, 'once')
      await until(() => signals().filter((one) => one.kind === 'ended').length === 2)
      driver.send('third')
      await until(() => signals().filter((one) => one.kind === 'asks').length === 2)
      driver.answer(signals().filter((one) => one.kind === 'asks')[1].ask, 'B')
      await until(() => signals().filter((one) => one.kind === 'ended').length === 3)
      assert(heard.flatMap((one) => one.items).some((one) => one.kind === 'theirs' && one.text === 'answer 3'))
    } finally { await driver.end() }
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previousConfig
    await rm(folder, { recursive: true, force: true })
  }
})
