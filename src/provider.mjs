import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as claude from "./claude-runtime.mjs";
const typingDelay = () => 15 + Math.floor(Math.random() * 31);
const object = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
const string = (value) => typeof value === "string" ? value : "";
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const terminalArgs = (options, config) => [
  "--permission-mode", options.mode,
  "--settings", JSON.stringify({ claudeMdExcludes: [join(config, "GECKIT.md")] }),
  ...options.model === void 0 ? [] : ["--model", options.model],
  ...options.resume ? ["--resume", options.id] : ["--session-id", options.id],
  ...options.resume || options.fork === void 0 ? [] : ["--fork-session", "--resume", options.fork.from, ...options.fork.at === void 0 ? [] : ["--resume-session-at", options.fork.at]]
];

const plain = (text) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replaceAll('\u00a0', ' ')

function terminalScreen(text) {
  const lines = plain(text).split('\n').map((line) => line.trimEnd())
  const trust = /Quick safety check:\s*Is this a project you created or one you trust\?/i.test(lines.join('\n')) && /Enter to confirm/i.test(text)
  const trustFocus = lines.some((line) => /^\s*[❯›>]\s*No, exit\s*$/.test(line)) ? 0 : lines.some((line) => /^\s*[❯›>]\s*Yes, I trust this folder\s*$/.test(line)) ? 1 : -1
  const selected = lines.findLastIndex((line) => /^\s*[❯›>]\s*\d+[.)]\s+/.test(line))
  if (selected !== -1 && /Enter to (?:select|confirm)|Esc to (?:cancel|go back)|↑.*↓|up.*down.*select/i.test(lines.slice(selected + 1).join('\n'))) {
    const choice = /^\s*(?:[❯›>]\s*)?(\d+)[.)]\s+(.+)$/
    const groups = []
    for (const [at, line] of lines.entries()) {
      const match = choice.exec(line)
      if (match === null) continue
      const option = { at, number: Number(match[1]), label: match[2].trim() }
      if (option.number !== (groups.at(-1)?.at(-1)?.number ?? 0) + 1) groups.push([])
      if (groups.length === 0) groups.push([])
      groups.at(-1).push(option)
    }
    const group = groups.find((options) => options.some((option) => option.at === selected)) ?? []
    const first = group[0]?.at ?? selected
    const border = lines.slice(0, first).findLastIndex((line) => /^\s*[─━-]{3}/.test(line))
    const above = lines.slice(border + 1, first).filter((line) => line.trim() !== '')
    const title = above.slice(-6).map((line) => line.trim()).join('\n') || 'Choose an option'
    const options = group.map(({ number, label }) => ({ number, label }))
    const focus = group.findIndex((option) => option.at === selected)
    const signature = JSON.stringify({ title, options })
    return { kind: 'question', title, options, focus, signature, trust, trustFocus }
  }
  const busy = lines.some((line) => /^\s*[✻✽✶✳✢·*].*(?:…|\.\.\.|esc to interrupt|ctrl\+c to interrupt|escape to interrupt)/i.test(line))
  const prompt = lines.findLastIndex((line) => /^\s*[❯›>](?:\s|$)/.test(line) && !/^\s*[❯›>]\s*\d+[.)]/.test(line))
  const bordered = prompt > 0 && /^\s*[─━-]{3}/.test(lines[prompt - 1]) && /^\s*[─━-]{3}/.test(lines[prompt + 1] ?? '')
  return { kind: busy ? 'working' : bordered ? 'idle' : 'unknown', trust, trustFocus }
}

function holdTmux(runtime, options, hear, left) {
  const { claudeCommand, OFF_PLAN, planOnly, claudeState, readClaude, claudeFile } = runtime;
  const environment = () => Object.fromEntries(Object.entries(planOnly()).filter(([key]) => !key.startsWith("GECKIT_")));
  const tmux = (args, input) => new Promise((resolve, reject) => {
    const child = execFile("tmux", [...args], { env: environment(), windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout.trim());
    });
    if (input !== void 0) child.stdin?.end(input);
  });
  if (process.platform === "win32" || options.root.startsWith("ssh://")) throw new Error("tmux mode is available for local macOS and Linux projects.");
  const name = `claude-${options.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const alive = () => tmux(["display-message", "-p", "-t", name, "#{pane_dead}"]).then((dead) => dead !== "1", () => false);
  const state = claudeState(options.root);
  let offset = 0;
  let remainder = Buffer.alloc(0);
  let running = false;
  let ended = false;
  let turn = false;
  let stopping = false;
  let activity = false;
  let failure = "";
  let idle = 0;
  let counter = 0;
  let pending;
  let answering = false;
  let reading = Promise.resolve();
  let poll;
  let polls = 0;
  let starting;
  let trustHandled = false;
  let imagesDirectory;
  let submitting = false;
  const emit = (items = [], gone = [], signals = []) => { if (!ended) hear({ items, gone, signals }); };
  const read = async () => {
    const path = await claudeFile(options.root, options.id);
    if (path === void 0) return;
    const size = (await stat(path)).size;
    if (size < offset) {
      offset = 0;
      remainder = Buffer.alloc(0);
    }
    if (size === offset) return;
    const file = await open(path, "r");
    let bytes;
    try {
      bytes = Buffer.alloc(size - offset);
      const result = await file.read(bytes, 0, bytes.length, offset);
      bytes = bytes.subarray(0, result.bytesRead);
      offset += result.bytesRead;
    } finally {
      await file.close();
    }
    const joined = Buffer.concat([remainder, bytes]);
    const end = joined.lastIndexOf(10);
    if (end < 0) {
      remainder = joined;
      return;
    }
    remainder = joined.subarray(end + 1);
    for (const line of joined.subarray(0, end).toString("utf8").split("\n")) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry["isSidechain"] === true) continue;
      if (entry["type"] === "system" && entry["subtype"] === "local_command" && entry["commandRun"] !== void 0) activity = true;
      if (entry["isMeta"] === true) continue;
      const type = string(entry["type"]);
      if (type === "cost-state") {
        const cost = entry["totalCostUSD"];
        if (typeof cost === "number") emit([], [], [{ kind: "spend", cost }]);
        continue;
      }
      if (type !== "assistant" && type !== "user" && type !== "system" && type !== "rate_limit_event") continue;
      const parsed = readClaude(state, type === "user" ? { ...entry, tool_use_result: entry["toolUseResult"] } : entry);
      const model = type === "assistant" ? string(object(entry["message"])["model"]) : "";
      if (type === "assistant" && parsed.items.length > 0) activity = true;
      if (!turn && parsed.items.some((item) => item.kind === "theirs")) {
        turn = true;
        emit([], [], [{ kind: "begun" }]);
      }
      if (type === "assistant" && entry["isApiErrorMessage"] === true) {
        failure = string(object(entry["message"])["content"]?.find?.((part) => part.type === "text")?.text) || "Claude Code API request failed.";
        activity = true;
      } else if (model !== "" && model !== "<synthetic>") failure = "";
      emit(parsed.items, parsed.gone, [...parsed.signals.filter((signal) => signal.kind !== "ended" && signal.kind !== "asks"), ...model === "" || model === "<synthetic>" ? [] : [{ kind: "model", model }]]);
    }
  };

  const clearImages = async () => {
    if (imagesDirectory === void 0) return;
    const directory = imagesDirectory;
    imagesDirectory = void 0;
    await rm(directory, { recursive: true, force: true });
  };
  const imagesIn = async (images) => {
    if (images.length === 0) return [];
    imagesDirectory ??= await mkdtemp(join(tmpdir(), "claude-images-"));
    const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp" };
    const paths = [];
    for (const image of images) {
      const path = join(imagesDirectory, `${randomUUID()}${extensions[image.media] ?? ".img"}`);
      await writeFile(path, Buffer.from(image.data, "base64"), { mode: 0o600, flag: "wx" });
      paths.push(path);
    }
    return paths;
  };
  const resolveQuestion = () => {
    if (pending === void 0) return;
    emit([], [], [{ kind: "resolved", ask: pending.id }]);
    pending = void 0;
  };
  const ask = (screen) => {
    if (pending?.signature === screen.signature) return;
    resolveQuestion();
    pending = { ...screen, id: `terminal:${String(++counter)}` };
    emit([], [], [{ kind: "asks", ask: pending.id, wanted: { kind: "question", question: screen.title, choices: screen.options.map((option) => option.label) } }]);
  };
  const confirmTrust = async (screen) => {
    if (!screen.trust || trustHandled || screen.trustFocus === -1) return;
    if (screen.trustFocus === 0) {
      await tmux(["send-keys", "-t", name, "Down"]);
      await delay(700);
      screen = terminalScreen(await tmux(["capture-pane", "-p", "-t", name]));
    }
    if (!screen.trust || screen.trustFocus !== 1) return;
    await tmux(["send-keys", "-t", name, "Enter"]);
    trustHandled = true;
  };
  const inspect = async () => {
    if (!running || ended || answering || submitting) return;
    const text = await tmux(["capture-pane", "-p", "-t", name]);
    if (ended) return;
    const screen = terminalScreen(text);
    if (screen.trust && !trustHandled) {
      await confirmTrust(screen);
      return;
    }
    if (screen.kind === "question") {
      idle = 0;
      activity = true;
      ask(screen);
    } else {
      resolveQuestion();
      if (screen.kind === "working") {
        activity = true;
        if (!turn) { turn = true; emit([], [], [{ kind: "begun" }]); }
      }
      if (turn && screen.kind === "idle" && (activity || stopping) && remainder.length === 0) idle += 1;
      else idle = 0;
      if (idle >= 2) {
        await read();
        if (remainder.length !== 0) { idle = 0; return; }
        if (!await alive()) throw new Error("Claude Code exited.");
        turn = false;
        await clearImages();
        emit([], [], [{ kind: "ended", how: stopping ? "stopped" : failure === "" ? "done" : "failed", ...failure === "" ? {} : { text: failure } }]);
        stopping = false;
        activity = false;
        idle = 0;
      }
    }
  };
  const catchUp = () => {
    reading = reading.then(async () => {
      if (++polls % 4 === 0 && !await alive()) throw new Error("Claude Code exited.");
      await read();
      await inspect();
    }).catch(async () => {
      if (!running || ended) return;
      if (await alive()) return;
      if (turn) emit([], [], [{ kind: "ended", how: "failed", text: "Claude Code exited." }]);
      void close();
    });
    return reading;
  };
  const start = async () => {
    if (ended) return;
    const path = await claudeFile(options.root, options.id);
    if (path !== void 0) offset = (await stat(path)).size;
    const env = environment();
    const omitted = [...OFF_PLAN, ...Object.keys(planOnly()).filter((key) => key.startsWith("GECKIT_"))];
    const config = env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
    const launch = ["exec", "env", ...omitted.flatMap((key) => ["-u", key]), `PATH=${env.PATH ?? ""}`, ...env.CLAUDE_CONFIG_DIR === void 0 ? [] : [`CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`], claudeCommand(env), ...terminalArgs(options, config)].map(quote).join(" ");
    await tmux(["new-session", "-d", "-s", name, "-x", "140", "-y", "50", "-c", options.root, launch]);
    if (ended) { await tmux(["kill-session", "-t", name]).catch(() => void 0); return; }
    running = true;
    poll = setInterval(() => { void catchUp(); }, 500);
  };
  const waitForPrompt = async () => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      if (ended) throw new Error("Claude Code session ended before input was ready.");
      const screen = terminalScreen(await tmux(["capture-pane", "-p", "-t", name]));
      if (screen.trust && !trustHandled) await confirmTrust(screen);
      else if (screen.kind === "idle") return;
      await delay(100);
    }
    throw new Error("Claude Code did not become ready for input.");
  };
  const keys = async (text, ready) => {
    for (const character of text) {
      await ready?.();
      if (character === "\n") {
        await tmux(["send-keys", "-l", "-t", name, "\\"]);
        await tmux(["send-keys", "-t", name, "Enter"]);
      } else {
        await tmux(["send-keys", "-l", "-t", name, character]);
      }
      await delay(typingDelay());
    }
    await ready?.();
    await tmux(["send-keys", "-t", name, "Enter"]);
  };
  const close = async () => {
    if (ended) return;
    ended = true;
    running = false;
    clearInterval(poll);
    await starting?.catch(() => void 0);
    await tmux(["kill-session", "-t", name]).catch(() => void 0);
    await reading;
    await clearImages();
    left();
  };
  return {
    async inject(text, images = [], before = []) {
      if (ended || !running || !turn || stopping) throw new Error("Claude Code is no longer working. Your message is still queued.");
      if (submitting || answering || pending !== void 0) throw new Error("Answer Claude Code's question before sending this message.");
      submitting = true;
      let typed = false;
      const ready = async () => {
        if (ended || stopping || !turn || !await alive()) throw new Error("Claude Code is no longer working. Your message is still queued.");
        const screen = terminalScreen(await tmux(["capture-pane", "-p", "-t", name]));
        if (screen.kind !== "working") throw new Error(screen.kind === "question" ? "Answer Claude Code's question before sending this message." : "Claude Code is not ready to receive this message. Your message is still queued.");
      };
      try {
        await ready();
        const paths = await imagesIn(images);
        await ready();
        const prompt = [...before, text, ...paths.map((path) => `Image attachment: ${path}`)].join("\n\n");
        typed = true;
        await keys(prompt, ready);
        idle = 0;
      } catch (error) {
        if (typed && !ended) {
          const screen = terminalScreen(await tmux(["capture-pane", "-p", "-t", name]).catch(() => ""));
          if (screen.kind === "working" || screen.kind === "idle") await tmux(["send-keys", "-t", name, "C-u"]).catch(() => void 0);
        }
        throw error;
      } finally {
        submitting = false;
      }
    },
    send(text, images = [], before = []) {
      if (ended) return;
      submitting = true;
      turn = true;
      emit([], [], [{ kind: "begun" }]);
      stopping = false;
      activity = false;
      failure = "";
      idle = 0;
      const sending = imagesIn(images).then(async (paths) => {
        const prompt = [...before, text, ...paths.map((path) => `Image attachment: ${path}`)].join("\n\n");
        if (!running && starting === void 0) starting = start();
        await starting;
        await waitForPrompt();
        emit([], [], [{ kind: "doing", what: "sending to Claude Code" }]);
        await keys(prompt);
        emit([], [], [{ kind: "doing", what: "waiting for Claude Code" }]);
      });
      void sending.finally(() => { submitting = false; }).catch((error) => {
        emit([], [], [{ kind: "ended", how: "failed", text: error.message }]);
        void close();
      });
    },
    answer(id, answer) {
      if (pending?.id !== id || answering || ended) return;
      answering = true;
      const current = pending;
      void (async () => {
        const screen = terminalScreen(await tmux(["capture-pane", "-p", "-t", name]));
        if (screen.kind !== "question" || screen.signature !== current.signature) {
          resolveQuestion();
          if (screen.kind === "question") ask(screen);
          return;
        }
        let index = screen.options.findIndex((option) => option.label === answer);
        let typed;
        if (index === -1) {
          index = screen.options.findIndex((option) => /^(?:Type something|Other\b)/i.test(option.label));
          typed = answer;
        }
        if (index === -1) {
          pending = void 0;
          ask(screen);
          return;
        }
        const distance = index - screen.focus;
        if (distance !== 0) await tmux(["send-keys", "-t", name, ...Array.from({ length: Math.abs(distance) }, () => distance < 0 ? "Up" : "Down")]);
        await tmux(["send-keys", "-t", name, "Enter"]);
        if (typed !== void 0) await keys(string(typed));
        pending = void 0;
        idle = 0;
      })().catch((error) => { emit([], [], [{ kind: "ended", how: "failed", text: error.message }]); void close(); }).finally(() => { answering = false; });
    },
    stop() {
      if (ended) return;
      stopping = true;
      resolveQuestion();
      void tmux(["send-keys", "-t", name, "C-c"]).catch(() => void 0);
    },
    end: close
  };
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const HOUR = 3600000;
const PERIODS = { fiveHour: 5 * HOUR, sevenDay: 7 * 24 * HOUR };

function resetTime(line, now) {
  const match = /Resets\s+(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i.exec(line);
  if (match === null) return void 0;
  const [, month, day, hour, minute, half] = match;
  const today = new Date(now);
  const at = new Date(today.getFullYear(), month === void 0 ? today.getMonth() : MONTHS.indexOf(month.toLowerCase()), month === void 0 ? today.getDate() : Number(day), Number(hour) % 12 + (half.toLowerCase() === "pm" ? 12 : 0), Number(minute ?? 0));
  if (month === void 0 && at.getTime() <= now) at.setDate(at.getDate() + 1);
  if (month !== void 0 && at.getTime() < now - 24 * HOUR) at.setFullYear(at.getFullYear() + 1);
  return at.getTime();
}

function usageScreen(text, now = Date.now()) {
  const lines = plain(text).split("\n").map((line) => line.trim());
  const window = (title) => {
    const at = lines.indexOf(title);
    if (at === -1) return void 0;
    const near = lines.slice(at + 1, at + 4);
    const used = near.map((line) => /(\d+(?:\.\d+)?)% used/.exec(line)).find((found) => found !== null);
    const resetsAt = near.map((line) => resetTime(line, now)).find((found) => found !== void 0);
    return used === void 0 || resetsAt === void 0 ? void 0 : { part: Number(used[1]) / 100, resetsAt };
  };
  const fiveHour = window("Current session");
  const sevenDay = window("Current week (all models)");
  if (fiveHour === void 0 && sevenDay === void 0) return void 0;
  return { ...fiveHour === void 0 ? {} : { fiveHour }, ...sevenDay === void 0 ? {} : { sevenDay } };
}

function planNow(plan, now) {
  const shown = {};
  for (const [key, window] of Object.entries(plan)) {
    let resetsAt = window.resetsAt;
    while (resetsAt <= now) resetsAt += PERIODS[key];
    shown[key] = resetsAt === window.resetsAt ? window : { part: 0, resetsAt };
  }
  return shown;
}

function usageReader(runtime, { name = "geckit-claude-usage", folder = join(tmpdir(), "geckit-claude-usage"), every = () => (15 + Math.random() * 15) * 60000 } = {}) {
  const { claudeCommand, OFF_PLAN, planOnly } = runtime;
  const environment = () => Object.fromEntries(Object.entries(planOnly()).filter(([key]) => !key.startsWith("GECKIT_")));
  const tmux = (args) => new Promise((resolve, reject) => {
    execFile("tmux", [...args], { env: environment(), windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout.trim());
    });
  });
  const screen = () => tmux(["capture-pane", "-p", "-J", "-t", name]);
  let plan;
  let next = 0;
  let reading;
  const read = async () => {
    if (await tmux(["has-session", "-t", name]).then(() => true, () => false)) await tmux(["send-keys", "-t", name, "Escape"]);
    else {
      await mkdir(folder, { recursive: true });
      const env = environment();
      const omitted = [...OFF_PLAN, ...Object.keys(planOnly()).filter((key) => key.startsWith("GECKIT_"))];
      const launch = ["exec", "env", ...omitted.flatMap((key) => ["-u", key]), `PATH=${env.PATH ?? ""}`, ...env.CLAUDE_CONFIG_DIR === void 0 ? [] : [`CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`], claudeCommand(env)].map(quote).join(" ");
      await tmux(["new-session", "-d", "-s", name, "-x", "140", "-y", "150", "-c", folder, launch]);
    }
    for (let attempt = 0; ; attempt += 1) {
      if (attempt === 300) throw new Error("Claude Code did not become ready for /usage.");
      const shown = terminalScreen(await screen());
      if (shown.trust && shown.trustFocus === 0) await tmux(["send-keys", "-t", name, "Down"]);
      else if (shown.trust && shown.trustFocus === 1) await tmux(["send-keys", "-t", name, "Enter"]);
      else if (shown.kind === "idle") break;
      await delay(shown.trust ? 700 : 100);
    }
    await tmux(["send-keys", "-l", "-t", name, "/usage"]);
    await delay(500);
    await tmux(["send-keys", "-t", name, "Enter"]);
    try {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        await delay(100);
        if (!/% used/.test(await screen())) continue;
        await delay(1000);
        return usageScreen(await screen());
      }
      return void 0;
    } finally {
      await tmux(["send-keys", "-t", name, "Escape"]).catch(() => void 0);
    }
  };
  return {
    async plan() {
      if (Date.now() >= next) {
        reading ??= read().then((found) => { if (found !== void 0) plan = found; }, () => void 0).finally(() => {
          next = Date.now() + every();
          reading = void 0;
        });
        await reading;
      }
      return plan === void 0 ? void 0 : planNow(plan, Date.now());
    },
    heard(said) {
      plan = { ...plan, ...said };
    },
    dispose: () => tmux(["kill-session", "-t", name]).catch(() => void 0)
  };
}

function create() {
  const usage = usageReader(claude);
  let known = [];
  return {
    id: "claude-tmux", family: "claude", transport: "tmux",
    name: "Claude Code (tmux)", shortName: "Claude", icon: "claude", browser: "claude",
    loginCommand: "claude auth login", planName: "Claude", localOnly: true,
    available: true, subscriptionOnly: true, images: true, remoteControl: false, nativeGoals: false, idleMs: 3600000, waitForExit: true,
    instructions: "own", setInstructions: async () => {},
    account: () => claude.claudeAccount(),
    program: () => claude.claudeProgram(),
    models: async () => {
      const found = await claude.claudeModels();
      if (found !== void 0) known = found;
      return found;
    },
    limits: async (models) => {
      const plan = await usage.plan();
      return { windows: new Map(models.map((model) => [model, known.find((one) => one.value === model || one.id === model)?.contextWindow])), ...plan === void 0 ? {} : { plan } };
    },
    list: async (roots) => {
      const rows = [];
      for (const root of roots) {
        for (const { below, ...row } of await claude.listClaude(root).catch(() => [])) rows.push(below === void 0 ? { ...row, root } : { ...row, root: below, project: root });
      }
      return rows;
    },
    search: (roots, asked) => claude.searchClaude(roots, asked),
    hidden: (from, to, include) => claude.everyClaude(from, to, include),
    create: async () => randomUUID(),
    fork: async (root, id, at) => {
      const point = await claude.forkPoint(root, id, at).catch(() => void 0);
      const items = (await claude.readClaudeSession(root, id).catch(() => void 0))?.items ?? [];
      const upTo = items.findLastIndex((item) => "at" in item && item.at !== void 0 && item.at <= at);
      return { id: randomUUID(), fork: { from: id, ...point === void 0 ? {} : { at: point } }, begun: false, items: items.slice(0, upTo + 1) };
    },
    has: async (root, id) => await claude.claudeFile(root, id) !== void 0,
    read: (root, id) => claude.readClaudeSession(root, id),
    links: (root, id) => claude.readLinks(root, id),
    goal: (root, id) => claude.readGoal(root, id),
    setGoal: async () => void 0,
    clearGoal: async () => void 0,
    rename: async () => {},
    remote: async () => { throw new Error("Claude Code (tmux) does not support remote control."); },
    mcp: (root, change) => claude.readMcp(root, change),
    browsers: async (root, pick) => root === void 0 ? void 0 : claude.readBrowsers(root, pick),
    correct: async () => ({ ok: false, error: "Claude Code correction is not available." }),
    delete: (root, id) => claude.deleteClaude(root, id),
    dispose: () => { void usage.dispose(); },
    hold: (options, hear, left) => holdTmux(claude, options, (heard) => {
      for (const signal of heard.signals) if (signal.kind === "plan") usage.heard(signal.plan);
      hear(heard);
    }, left)
  };
}
export { create, holdTmux, planNow, terminalScreen, usageReader, usageScreen };
