import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { createServer } from "node:http";
const object = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
const string = (value) => typeof value === "string" ? value : "";
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const terminalArgs = (options, settings, sourceArgs) => [
  "--permission-mode",
  options.mode,
  "--settings",
  settings,
  ...sourceArgs(),
  ...options.model === void 0 ? [] : ["--model", options.model],
  ...options.resume ? ["--resume", options.id] : ["--session-id", options.id],
  ...options.resume || options.fork === void 0 ? [] : [
    "--fork-session",
    "--resume",
    options.fork.from,
    ...options.fork.at === void 0 ? [] : ["--resume-session-at", options.fork.at]
  ]
];
function holdTmux(host, options, hear, left) {
  const { claudeCommand, offPlan: OFF_PLAN, planOnly, claudeState, readClaude, claudeFile, sourceArgs, askId, questionsFromClaude, wantedFromClaude } = host;
  const tmux = (args, input) => new Promise((resolve, reject) => {
    const child = execFile("tmux", [...args], { env: planOnly(), windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout.trim());
    });
    if (input !== void 0) child.stdin?.end(input);
  });
  if (process.platform === "win32" || options.root.startsWith("ssh://")) throw new Error("tmux mode is available for local macOS and Linux projects.");
  const name = `geckit-${options.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const token = randomUUID();
  const state = claudeState(options.root);
  const asks = /* @__PURE__ */ new Map();
  let offset = 0;
  let remainder = Buffer.alloc(0);
  let running = false;
  let ended = false;
  let turn = false;
  let lastText = "";
  let fallback;
  let fallbackText;
  const displayed = /* @__PURE__ */ new Map();
  let counter = 0;
  let reading = Promise.resolve();
  let poll;
  let polls = 0;
  let starting;
  const emit = (items = [], gone = [], signals = []) => {
    if (!ended) hear({ items, gone, signals });
  };
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
      if (entry["isSidechain"] === true || entry["isMeta"] === true) continue;
      const type = string(entry["type"]);
      if (type === "cost-state") {
        const cost = entry["totalCostUSD"];
        if (typeof cost === "number") emit([], [], [{ kind: "spend", cost }]);
        continue;
      }
      if (type !== "assistant" && type !== "user" && type !== "system" && type !== "rate_limit_event") continue;
      const parsed = readClaude(state, type === "user" ? { ...entry, tool_use_result: entry["toolUseResult"] } : entry);
      const said = parsed.signals.find((signal) => signal.kind === "said");
      if (said?.kind === "said") lastText = said.text;
      const model = type === "assistant" ? string(object(entry["message"])["model"]) : "";
      const shown = said?.kind === "said" ? [...displayed].find(([, parts]) => parts.join("") === said.text)?.[0] : void 0;
      if (shown !== void 0) displayed.delete(shown);
      const gone = [
        ...parsed.gone,
        ...shown === void 0 ? [] : [`tmux:message:${shown}`],
        ...fallback !== void 0 && said?.kind === "said" && said.text === fallbackText ? [fallback] : []
      ];
      if (fallback !== void 0 && gone.includes(fallback)) {
        fallback = void 0;
        fallbackText = void 0;
      }
      emit(parsed.items, gone, [...parsed.signals.filter((signal) => signal.kind !== "ended" && signal.kind !== "asks"), ...model === "" || model === "<synthetic>" ? [] : [{ kind: "model", model }]]);
    }
  };
  const catchUp = () => {
    reading = reading.then(read, read).catch(() => void 0);
    return reading;
  };
  const reply = (response, body = {}) => {
    if (response.writableEnded) return;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const decision = (pending, answer) => {
    if (pending.event === "PermissionRequest") return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: answer === "no" ? { behavior: "deny", message: "The user denied this action." } : { behavior: "allow", updatedInput: pending.input }
      }
    };
    if (pending.tool === "AskUserQuestion") return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { ...pending.input, answers: pending.answers }
      }
    };
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: answer === "no" ? "deny" : "allow",
        updatedInput: pending.input
      }
    };
  };
  const deny = (pending) => pending.event === "PermissionRequest" ? { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "GeckIt stopped this turn." } } } : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "GeckIt stopped this turn." } };
  const hook = async (body, response) => {
    const event = string(body["hook_event_name"]);
    if (string(body["session_id"]) !== options.id) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (event === "PermissionRequest" || event === "PreToolUse") {
      await catchUp();
      const id = `tmux:${String(++counter)}`;
      const input = object(body["tool_input"]);
      const tool = string(body["tool_name"]);
      const questions = event === "PreToolUse" && tool === "AskUserQuestion" ? questionsFromClaude(input) : [];
      const wanted = questions[0] ?? wantedFromClaude(tool, input);
      asks.set(id, { response, input, event, tool, questions: questions.map((one) => one.kind === "question" ? one.question : ""), answers: {} });
      emit([], [], [{ kind: "asks", ask: id, wanted }]);
      return;
    }
    if (event === "UserPromptSubmit") {
      turn = true;
      lastText = "";
      emit([], [], [{ kind: "begun" }]);
    }
    if (event === "MessageDisplay") {
      const id = string(body["message_id"]);
      const index = body["index"];
      if (id !== "" && typeof index === "number" && index >= 0 && index < 1e5) {
        const parts = displayed.get(id) ?? [];
        parts[index] = string(body["delta"]);
        displayed.set(id, parts);
        const text = parts.join("");
        if (text !== "") {
          lastText = text;
          emit([{ kind: "theirs", id: `tmux:message:${id}`, text }], [], [{ kind: "said", text }]);
        }
      }
    }
    if (event === "Stop" || event === "StopFailure") {
      await catchUp();
      if (event === "Stop") {
        const final = string(body["last_assistant_message"]);
        if (final !== "" && final !== lastText) {
          fallback = `tmux:final:${String(++counter)}`;
          fallbackText = final;
          emit([{ kind: "theirs", id: fallback, text: final }], [], [{ kind: "said", text: final }]);
        }
      }
      turn = false;
      emit([], [], [{ kind: "ended", how: event === "Stop" ? "done" : "failed", ...event === "StopFailure" && string(body["error"]) !== "" ? { text: string(body["error"]) } : {} }]);
    }
    reply(response);
  };
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403);
      response.end();
      return;
    }
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1e6) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        void hook(JSON.parse(Buffer.concat(chunks).toString("utf8")), response);
      } catch {
        response.writeHead(400);
        response.end();
      }
    });
  });
  server.requestTimeout = 0;
  server.timeout = 0;
  const ready = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const start = async (prompt) => {
    await ready;
    if (ended) return;
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Hook server did not start.");
    const path = await claudeFile(options.root, options.id);
    if (path !== void 0) offset = (await stat(path)).size;
    const handler = { type: "http", url: `http://127.0.0.1:${String(address.port)}/`, timeout: 3600, headers: { Authorization: `Bearer ${token}` } };
    const hooks = Object.fromEntries(["Stop", "StopFailure", "PermissionRequest", "UserPromptSubmit", "MessageDisplay"].map((event) => [event, [{ hooks: [handler] }]]));
    const settings = JSON.stringify({ hooks: { ...hooks, PreToolUse: [{ matcher: "AskUserQuestion|ExitPlanMode", hooks: [handler] }] } });
    const env = planOnly();
    const launch = ["exec", "env", ...OFF_PLAN.flatMap((key) => ["-u", key]), `PATH=${env.PATH ?? ""}`, ...env.CLAUDE_CONFIG_DIR === void 0 ? [] : [`CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`], claudeCommand(env), ...terminalArgs(options, settings, sourceArgs), prompt].map(quote).join(" ");
    await tmux(["new-session", "-d", "-s", name, "-c", options.root, launch]);
    running = true;
    poll = setInterval(() => {
      void catchUp();
      if (++polls % 4 !== 0) return;
      void tmux(["has-session", "-t", name]).catch(() => {
        if (!running || ended) return;
        running = false;
        if (turn) emit([], [], [{ kind: "ended", how: "failed", text: "Claude Code exited." }]);
        void close();
      });
    }, 500);
  };
  const keys = async (text) => {
    await ready;
    const buffer = `geckit-${randomUUID()}`;
    await tmux(["load-buffer", "-b", buffer, "-"], text);
    await tmux(["paste-buffer", "-p", "-d", "-b", buffer, "-t", name]);
    await tmux(["send-keys", "-t", name, "Enter"]);
  };
  const close = async () => {
    if (ended) return;
    ended = true;
    running = false;
    clearInterval(poll);
    await starting?.catch(() => void 0);
    for (const pending of asks.values()) reply(pending.response, deny(pending));
    asks.clear();
    server.close();
    await tmux(["kill-session", "-t", name]).catch(() => void 0);
    left();
  };
  return {
    send(text, images = [], before = []) {
      if (ended) return;
      if (images.length > 0) {
        emit([], [], [{ kind: "ended", how: "failed", text: "tmux mode supports text only." }]);
        return;
      }
      turn = true;
      lastText = "";
      const prompt = [...before, text].join("\n\n");
      const sending = running ? keys(prompt) : starting === void 0 ? starting = start(prompt) : starting.then(() => keys(prompt));
      void sending.catch((error) => {
        emit([], [], [{ kind: "ended", how: "failed", text: error.message }]);
        void close();
      });
    },
    answer(ask, answer) {
      const [id = ask, position = "0"] = ask.split("#");
      const pending = asks.get(id);
      if (pending === void 0) return;
      if (pending.questions.length > 0) {
        const index = Number(position);
        pending.answers[pending.questions[index] ?? ""] = answer;
        const next = questionsFromClaude(pending.input)[index + 1];
        if (next !== void 0) {
          emit([], [], [{ kind: "asks", ask: askId(id, index + 1), wanted: next }]);
          return;
        }
      }
      asks.delete(id);
      reply(pending.response, decision(pending, answer));
    },
    stop() {
      for (const pending of asks.values()) reply(pending.response, deny(pending));
      asks.clear();
      void tmux(["send-keys", "-t", name, "C-c"]).then(() => setTimeout(() => {
        if (!turn || ended) return;
        turn = false;
        emit([], [], [{ kind: "ended", how: "stopped" }]);
      }, 1e3)).catch(() => void 0);
    },
    end: close
  };
}
function create(host) {
  return {
    ...host.claude,
    id: "claude-tmux",
    family: "claude",
    transport: "tmux",
    name: "Claude Code (tmux)",
    shortName: "Claude",
    icon: "claude",
    browser: "claude",
    loginCommand: "claude auth login",
    planName: "Claude",
    localOnly: true,
    subscriptionOnly: true,
    images: false,
    remoteControl: false,
    idleMs: 12e4,
    waitForExit: true,
    hold: (options, hear, left) => holdTmux(host, options, hear, left)
  };
}
export {
  create,
  holdTmux
};
