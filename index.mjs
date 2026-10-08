import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
  const trustFocus = lines.some((line) => /^\s*❯\s*No, exit\s*$/.test(line)) ? 0 : lines.some((line) => /^\s*❯\s*Yes, I trust this folder\s*$/.test(line)) ? 1 : -1
  const selected = lines.findLastIndex((line) => /^\s*❯\s*\d+[.)]\s+/.test(line))
  if (selected !== -1 && /Enter to (?:select|confirm)|Esc to (?:cancel|go back)|↑.*↓|up.*down.*select/i.test(lines.slice(selected + 1).join('\n'))) {
    const choice = /^\s*(?:❯\s*)?(\d+)[.)]\s+(.+)$/
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
  const prompt = lines.findLastIndex((line) => /^\s*❯(?:\s|$)/.test(line) && !/^\s*❯\s*\d+[.)]/.test(line))
  const bordered = prompt > 0 && /^\s*[─━-]{3}/.test(lines[prompt - 1]) && /^\s*[─━-]{3}/.test(lines[prompt + 1] ?? '')
  return { kind: busy ? 'working' : bordered ? 'idle' : 'unknown', trust, trustFocus }
}

function holdTmux(host, options, hear, left) {
  const { claudeCommand, offPlan: OFF_PLAN, planOnly, claudeState, readClaude, claudeFile } = host;
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
  const inspect = async () => {
    if (!running || ended || answering || submitting) return;
    const text = await tmux(["capture-pane", "-p", "-t", name]);
    if (ended) return;
    const screen = terminalScreen(text);
    if (screen.trust && !trustHandled) {
      if (screen.trustFocus === -1) return;
      trustHandled = true;
      await tmux(["send-keys", "-t", name, ...screen.trustFocus === 0 ? ["Down"] : [], "Enter"]);
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
      if (screen.trust && !trustHandled && screen.trustFocus !== -1) {
        trustHandled = true;
        await tmux(["send-keys", "-t", name, ...(screen.trustFocus === 0 ? ["Down"] : []), "Enter"]);
      } else if (screen.kind === "idle") return;
      await delay(100);
    }
    throw new Error("Claude Code did not become ready for input.");
  };
  const keys = async (text) => {
    for (const character of text) {
      if (character === "\n") {
        await tmux(["send-keys", "-l", "-t", name, "\\"]);
        await tmux(["send-keys", "-t", name, "Enter"]);
      } else {
        await tmux(["send-keys", "-l", "-t", name, character]);
      }
      await delay(typingDelay());
    }
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
function create(host) {
  return {
    ...host.claude,
    id: "claude-tmux", family: "claude", transport: "tmux",
    name: "Claude Code (tmux)", shortName: "Claude", icon: "claude", browser: "claude",
    loginCommand: "claude auth login", planName: "Claude", localOnly: true,
    subscriptionOnly: true, images: true, remoteControl: false, idleMs: 3600000, waitForExit: true,
    instructions: "own", setInstructions: async () => {},
    hold: (options, hear, left) => holdTmux(host, options, hear, left)
  };
}
export { create, holdTmux, terminalScreen };
