var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/provider.mjs
import { execFile as execFile2 } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open as open3, rm as rm2, stat as stat3, writeFile } from "node:fs/promises";
import { homedir as homedir5, tmpdir } from "node:os";
import { join as join4 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// src/claude-runtime.mjs
var claude_runtime_exports = {};
__export(claude_runtime_exports, {
  OFF_PLAN: () => OFF_PLAN,
  claudeAccount: () => claudeAccount,
  claudeCommand: () => claudeCommand,
  claudeFile: () => claudeFile,
  claudeModels: () => claudeModels,
  claudeProgram: () => claudeProgram,
  claudeState: () => claudeState,
  deleteClaude: () => deleteClaude,
  everyClaude: () => everyClaude,
  forkPoint: () => forkPoint,
  listClaude: () => listClaude,
  planOnly: () => planOnly,
  readBrowsers: () => readBrowsers,
  readClaude: () => readClaude,
  readClaudeSession: () => readClaudeSession,
  readGoal: () => readGoal,
  readLinks: () => readLinks,
  readMcp: () => readMcp,
  searchClaude: () => searchClaude
});
import { createRequire as geckitCreateRequire } from "node:module";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { isAbsolute as isAbsolute2, relative, resolve, sep } from "node:path";
import { homedir as homedir2 } from "node:os";
import { basename } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { open, readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { join as join2 } from "node:path";
import { spawn as spawn2 } from "node:child_process";
import { createInterface as createInterface2 } from "node:readline";
import { spawn as spawn3 } from "node:child_process";
import { homedir as homedir4 } from "node:os";
import { createInterface as createInterface3 } from "node:readline";
import { open as open2, readdir as readdir2, stat as stat2 } from "node:fs/promises";
import { join as join3 } from "node:path";
var require2 = geckitCreateRequire(import.meta.url);
var OFF_PLAN = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY"
];
function planOnly(env = process.env) {
  const kept2 = { ...env };
  for (const name of OFF_PLAN) delete kept2[name];
  const key = pathKey(kept2);
  const extra = WINDOWS ? [join(homedir(), ".local", "bin")] : [join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  const path = (kept2[key] ?? "").split(delimiter);
  kept2[key] = [...path, ...extra.filter((one) => !path.includes(one))].filter((one) => one !== "").join(delimiter);
  return kept2;
}
var WINDOWS = process.platform === "win32";
var pathKey = (env) => Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
function claudeCommand(env = planOnly()) {
  if (!WINDOWS) return "claude";
  for (const dir of (env[pathKey(env)] ?? "").split(delimiter)) {
    if (dir === "") continue;
    const exe = join(dir, "claude.exe");
    if (existsSync(exe)) return exe;
    const shimmed = join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (existsSync(join(dir, "claude.cmd")) && existsSync(shimmed)) return shimmed;
  }
  return "claude";
}
var string = (value) => typeof value === "string" ? value : "";
var planName = (plan2) => plan2 === "" ? "" : plan2.slice(0, 1).toUpperCase() + plan2.slice(1).replace(/[_-]+/g, " ");
function whoFrom(orgId, email) {
  if (orgId === void 0 || orgId === "" || email === void 0 || email === "") return void 0;
  return createHash("sha256").update(`${orgId}
${email}`).digest("hex").slice(0, 16);
}
var printed = (args) => new Promise((done) => {
  const env = planOnly();
  execFile(claudeCommand(env), [...args], { cwd: homedir(), timeout: 15e3, env, windowsHide: true }, (error, stdout) => {
    const code = error?.code;
    done(typeof code === "string" ? void 0 : stdout);
  });
});
async function claudeAccount() {
  const out = await printed(["auth", "status"]);
  return out === void 0 ? { here: false, signedIn: void 0 } : accountFrom(out);
}
function accountFrom(out) {
  try {
    const said = JSON.parse(out);
    if (said["loggedIn"] !== true) return { here: true, signedIn: false };
    const plan2 = planName(string(said["subscriptionType"]));
    const who = whoFrom(string(said["orgId"]) || void 0, string(said["email"]) || void 0);
    return { here: true, signedIn: true, ...plan2 === "" ? { key: true } : { plan: plan2 }, ...who === void 0 ? {} : { who } };
  } catch {
    return { here: true, signedIn: void 0 };
  }
}
function versionOf(printed2) {
  return /^\s*(\d+\.\d+\.\d+\S*)/.exec(printed2)?.[1];
}
function installedBy(path) {
  const where = path.replaceAll("\\", "/");
  if (/\/(Caskroom|Cellar)\//.test(where)) return "Homebrew";
  if (where.includes("/node_modules/@anthropic-ai/claude-code/")) return "npm";
  if (/\/\.local\/(share\/claude\/|bin\/claude)/.test(where)) return "the native installer";
  return void 0;
}
function programPath(env) {
  const command = claudeCommand(env);
  const found = isAbsolute(command) ? command : (env[pathKey(env)] ?? "").split(delimiter).filter((dir) => dir !== "").map((dir) => join(dir, command)).find((one) => existsSync(one));
  if (found === void 0) return void 0;
  try {
    return realpathSync(found);
  } catch {
    return found;
  }
}
async function claudeProgram() {
  const version = versionOf(await printed(["--version"]) ?? "");
  if (version === void 0) return void 0;
  const path = programPath(planOnly());
  const from = path === void 0 ? void 0 : installedBy(path);
  return { version, ...from === void 0 ? {} : { from }, ...path === void 0 ? {} : { path } };
}
var askId = (request, index) => index === 0 ? request : `${request}#${String(index)}`;
var cardId = (ask) => `card:${ask}`;
function within(root, path) {
  if (path === "") return void 0;
  const inside = relative(root, resolve(root, path));
  if (inside === "" || inside.startsWith("..") || isAbsolute2(inside)) return void 0;
  return inside.split(sep).join("/");
}
function filesAmong(root, paths) {
  const found = [];
  for (const path of paths) {
    const inside = within(root, path);
    if (inside !== void 0 && !found.includes(inside)) found.push(inside);
  }
  return found;
}
var modelVersion = (id) => {
  const match = /^(?:claude-[a-z]+-|gpt-)(\d+)(?:[-.](\d+))?(?:-|\[|$)/.exec(id);
  return match === null ? void 0 : [match[1], match[2]].filter((part) => part !== void 0).join(".");
};
var sentence = (doing) => doing.charAt(0).toUpperCase() + doing.slice(1);
function shown(root, path) {
  const inside = within(root, path);
  if (inside !== void 0) return inside;
  const home = homedir2();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
var text = (value) => typeof value === "string" ? value : "";
function firstLine(said, most = 120) {
  const line = said.split("\n").map((one) => one.trim()).find((one) => one !== "") ?? "";
  return line.length > most ? `${line.slice(0, most - 1).trimEnd()}...` : line;
}
function plain(said) {
  return said.replace(/^\s*(```|~~~).*$/gm, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|~~|`/g, "").replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, "");
}
var saidLine = (said, most) => firstLine(plain(said), most);
var literal = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function tidy(command, root) {
  const folder = root.replace(/\/+$/, "");
  const named = `(?:${literal(folder)}|"${literal(folder)}"|'${literal(folder)}')`;
  const home = homedir2();
  return command.trim().replace(new RegExp(`^cd\\s+${named}/?\\s*(?:&&|;)\\s*`), "").split(`${folder}/`).join("").split(folder).join(".").split(`${home}/`).join("~/");
}
var host = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
var about = (root, path) => {
  const inside = within(root, path);
  return inside === void 0 ? {} : { path: inside };
};
function claudeLine(tool, input, root) {
  const path = text(input["file_path"]) || text(input["notebook_path"]) || text(input["path"]);
  switch (tool) {
    case "Read": {
      if (/\/tasks\/[a-z0-9]+\.output$/.test(path) && within(root, path) === void 0) {
        return { done: "Read what a background task printed", doing: "reading what a background task printed" };
      }
      const name = shown(root, path);
      return { done: `Read ${name}`, doing: `reading ${name}`, ...about(root, path) };
    }
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit": {
      const name = shown(root, path);
      return { done: `Changed ${name}`, doing: `changing ${name}`, ...about(root, path) };
    }
    case "Bash":
    case "PowerShell": {
      const command = firstLine(tidy(text(input["command"]), root));
      if (input["run_in_background"] === true) {
        return { done: `Started in the background: ${command}`, doing: `starting in the background: ${command}` };
      }
      return { done: `Ran ${command}`, doing: `running ${command}` };
    }
    case "Monitor": {
      const what = firstLine(text(input["description"]) || tidy(text(input["command"]), root), 80);
      return { done: `Watching in the background: ${what}`, doing: `starting to watch: ${what}` };
    }
    case "TaskStop":
    case "KillShell":
      return { done: "Stopped a background task", doing: "stopping a background task" };
    case "TaskOutput":
    case "BashOutput":
      return { done: "Read what a background task printed", doing: "reading what a background task printed" };
    case "Grep": {
      const pattern = text(input["pattern"]);
      return { done: `Searched the folder for ${pattern}`, doing: `searching for ${pattern}` };
    }
    case "Glob": {
      const pattern = text(input["pattern"]);
      return { done: `Looked for ${pattern}`, doing: `looking for ${pattern}` };
    }
    case "WebFetch": {
      const where = host(text(input["url"]));
      return { done: `Opened ${where}`, doing: `opening ${where}` };
    }
    case "WebSearch": {
      const query = text(input["query"]);
      return { done: `Searched the web for ${query}`, doing: `searching the web for ${query}` };
    }
    case "Task":
    case "Agent": {
      const what = firstLine(text(input["description"]) || text(input["prompt"]), 80);
      if (input["run_in_background"] === true) {
        return { done: `Handed off in the background: ${what}`, doing: `handing off in the background: ${what}` };
      }
      return { done: `Handed off: ${what}`, doing: `handing off: ${what}` };
    }
    case "Skill": {
      const skill = text(input["skill"]);
      return { done: `Used the ${skill} skill`, doing: `using the ${skill} skill` };
    }
    case "AskUserQuestion":
    case "ExitPlanMode":
    case "EnterPlanMode":
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
    case "TaskGet":
    case "TaskList":
    case "ToolSearch":
      return void 0;
    default: {
      const parts = /^mcp__(.+?)__(.+)$/.exec(tool);
      const name = parts === null ? tool : `${parts[2] ?? tool} from ${parts[1] ?? ""}`;
      return { done: `Used ${name}`, doing: `using ${name}` };
    }
  }
}
var movedLine = (input, root) => `Moved to the background: ${firstLine(tidy(text(input["command"]), root))}`;
function wantedFromClaude(tool, input) {
  const path = text(input["file_path"]) || text(input["notebook_path"]);
  switch (tool) {
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return { kind: "write", paths: [path] };
    case "Bash":
    case "PowerShell":
      return { kind: "command", command: text(input["command"]) };
    case "WebFetch":
      return { kind: "web", url: text(input["url"]) };
    case "WebSearch":
      return { kind: "web", url: text(input["query"]) };
    case "Read":
      return { kind: "read", path: path || text(input["path"]) };
    case "Grep":
    case "Glob":
      return { kind: "read", path: text(input["path"]) };
    case "ExitPlanMode":
      return { kind: "start", plan: text(input["plan"]) };
    case "AskUserQuestion":
      return questionsFromClaude(input)[0] ?? { kind: "question", question: "", choices: [] };
    default:
      return { kind: "other", tool, detail: JSON.stringify(input, void 0, 2) };
  }
}
function questionsFromClaude(input) {
  const questions = Array.isArray(input["questions"]) ? input["questions"] : [];
  return questions.map((raw) => {
    const one = raw ?? {};
    const options = Array.isArray(one["options"]) ? one["options"] : [];
    return {
      kind: "question",
      question: text(one["question"]),
      choices: options.map((option) => text(option["label"])).filter((label) => label !== "")
    };
  });
}
function cardFor(wanted, root) {
  const folder = `in ${basename(root)}`;
  switch (wanted.kind) {
    case "command":
      return { kind: "permission", title: "Wants to run a command", detail: wanted.command, where: folder };
    case "write": {
      const inside = wanted.paths.map((path) => within(root, path));
      if (inside.every((path) => path !== void 0)) {
        return { kind: "permission", title: `Wants to change ${inside.join(", ")}` };
      }
      return {
        kind: "permission",
        title: "Wants to change a file",
        detail: wanted.paths.map((path) => shown(root, path)).join("\n"),
        where: "Outside this folder"
      };
    }
    case "read": {
      const inside = within(root, wanted.path);
      if (inside !== void 0) return { kind: "permission", title: `Wants to read ${inside}` };
      return {
        kind: "permission",
        title: "Wants to read a file",
        detail: shown(root, wanted.path),
        where: "Outside this folder"
      };
    }
    case "web":
      return { kind: "permission", title: "Wants to open a web page", detail: wanted.url };
    case "question":
      return { kind: "question", title: wanted.question, choices: wanted.choices };
    case "start":
      return { kind: "start", title: "Wants to start making these changes", detail: wanted.plan };
    case "other":
      return { kind: "permission", title: `Wants to use ${wanted.tool}`, detail: wanted.detail };
  }
}
function subject(wanted, root) {
  switch (wanted.kind) {
    case "command":
      return firstLine(tidy(wanted.command, root));
    case "write":
      return wanted.paths.map((path) => shown(root, path)).join(", ");
    case "read":
      return shown(root, wanted.path);
    case "web":
      return wanted.url;
    case "start":
      return "making changes";
    case "question":
      return wanted.question;
    case "other":
      return wanted.tool;
  }
}
function answeredLine(wanted, answer, root) {
  if (wanted.kind === "question") return `Answered: ${answer}`;
  const what = subject(wanted, root);
  if (answer === "once") return `Allowed: ${what}`;
  if (answer === "session") return `Allowed for this session: ${what}`;
  return `Not allowed: ${what}`;
}
var SUMMARISED = "Earlier messages were summarised by Claude Code.";
var goalEnded = (condition, met) => met ? `Goal met: ${condition}` : `Goal given up, the check found it cannot be met: ${condition}`;
var STOPPED = "Stopped.";
var PICTURES = 24e6;
function claudeState(root) {
  return {
    root,
    tools: /* @__PURE__ */ new Map(),
    open: void 0,
    grown: "",
    seq: 0,
    wrote: [],
    thought: false,
    interrupted: false,
    synthetic: void 0,
    limit: void 0,
    summarised: void 0,
    backgrounded: /* @__PURE__ */ new Set(),
    tasks: /* @__PURE__ */ new Map(),
    uses: /* @__PURE__ */ new Map(),
    budget: { left: PICTURES }
  };
}
var string2 = (value) => typeof value === "string" ? value : "";
var object = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
var list = (value) => Array.isArray(value) ? value : [];
var MOST = 4e3;
var WRITES = /* @__PURE__ */ new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
var COMMANDS = /* @__PURE__ */ new Set(["Bash", "PowerShell"]);
function picturesIn(content, budget) {
  const out = [];
  for (const block of list(content)) {
    const one = object(block);
    if (string2(one["type"]) !== "image") continue;
    const source = object(one["source"]);
    const data = string2(source["data"]);
    if (string2(source["type"]) !== "base64" || data === "" || data.length > budget.left) continue;
    budget.left -= data.length;
    out.push({ media: string2(source["media_type"]) || "image/png", data });
  }
  return out;
}
function resultText(content) {
  if (typeof content === "string") return content;
  return list(content).map((block) => string2(object(block)["text"])).filter((part) => part !== "").join("\n");
}
var clipped = (body) => body.length > MOST ? `${body.slice(0, MOST)}
... (${String(body.length - MOST)} more characters)` : body;
var NOT_SAID = /^\s*(<(command-|local-command|system-reminder|bash-|task-notification|user-prompt-submit-hook)|Caveat:)/;
var INTERRUPTED = /^\[Request interrupted by user/;
var SUMMARY_HEAD = /^This session is being continued[^\n]*\n+Summary:\n/;
var HELD = /^Stop hook feedback:\n\[([\s\S]*?)\]: ([\s\S]*)$/;
var TASK_NOTIFICATION = /^\s*<task-notification>([\s\S]*)<\/task-notification>\s*$/;
var tagged = (body, tag) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)?.[1]?.trim() ?? "";
function taskNote(id, status, summary) {
  if (id === "" || summary === "" || status === "stopped" || status === "killed") return void 0;
  return { kind: "note", id: `task:${id}`, note: "task", text: summary };
}
var ENDED = {
  completed: "completed",
  failed: "failed",
  stopped: "stopped",
  killed: "stopped"
};
var WRITES_TO = /(?:Output is being written to|output_file): (\S+?)\.?(?:\s|$)/;
function keepTask(state, out, task) {
  state.tasks.set(task.id, task);
  if (state.backgrounded.has(task.id)) out.signals.push({ kind: "task", task });
}
var BASH_INPUT = /^\s*<bash-input>([\s\S]*)<\/bash-input>\s*$/;
var BASH_OUTPUT = /^\s*<bash-stdout>([\s\S]*)<\/bash-stdout>\s*<bash-stderr>([\s\S]*)<\/bash-stderr>\s*$/;
var textsOf = (content) => typeof content === "string" ? [content] : list(content).map(object).filter((block) => string2(block["type"]) === "text").map((block) => string2(block["text"]));
var REFUSED = "The person reading said no to this. Do not try it another way; say what you would have done instead.";
var AGAIN = "The person changed how this session may act while this was waiting. Make the same tool call again, unchanged.";
var refused = (said) => said.includes(REFUSED) || said.startsWith("The user doesn't want to proceed with this tool use");
var SIGNED_OUT = /\/login|not logged in|invalid api key|authenticat|unauthori[sz]ed|oauth token/i;
var LIMIT = /usage limit|hit your limit|limit reached|rate limit/i;
function empty() {
  return { items: [], gone: [], signals: [] };
}
function flush(state, out) {
  if (state.wrote.length > 0) {
    state.seq += 1;
    out.items.push({ kind: "wrote", id: `wrote:${String(state.seq)}`, paths: state.wrote });
  }
  state.wrote = [];
  state.thought = false;
}
function stamped(entry) {
  const at = Date.parse(string2(entry["timestamp"]));
  return Number.isNaN(at) ? {} : { at };
}
function assistantBlocks(state, message, out) {
  const inner = object(message["message"]);
  const id = string2(message["uuid"]);
  const synthetic = string2(inner["model"]) === "<synthetic>";
  for (const [index, raw] of list(inner["content"]).entries()) {
    const block = object(raw);
    const kind = string2(block["type"]);
    const item = `${id}:${String(index)}`;
    if (kind === "text") {
      const text2 = string2(block["text"]);
      if (state.open !== void 0) {
        out.gone.push(state.open);
        state.open = void 0;
        state.grown = "";
      }
      if (text2.trim() === "") continue;
      if (synthetic) {
        state.synthetic = text2;
        continue;
      }
      out.items.push({ kind: "theirs", id: item, text: text2, ...stamped(message) });
      out.signals.push({ kind: "said", text: text2 });
      continue;
    }
    if (kind === "thinking") {
      const text2 = string2(block["thinking"]);
      if (text2 === "" && state.thought) continue;
      state.thought = true;
      out.items.push({ kind: "thought", id: item, text: text2 });
      continue;
    }
    if (kind !== "tool_use") continue;
    const tool = string2(block["name"]);
    const use = string2(block["id"]);
    const input = object(block["input"]);
    if (WRITES.has(tool)) {
      const path = string2(input["file_path"]) || string2(input["notebook_path"]);
      if (path !== "") out.signals.push({ kind: "writing", paths: [path] });
    }
    const line = claudeLine(tool, input, state.root);
    if (line === void 0) {
      state.tools.set(use, { item: { kind: "did", id: use, what: "" }, tool, input });
      continue;
    }
    const did = {
      kind: "did",
      id: use,
      what: line.done,
      ...line.path === void 0 ? {} : { path: line.path }
    };
    state.tools.set(use, { item: did, tool, input });
    out.items.push({ ...did, what: sentence(line.doing), live: true });
    out.signals.push({ kind: "doing", what: line.doing });
  }
}
function toolResults(state, message, out) {
  let any = false;
  for (const raw of list(object(message["message"])["content"])) {
    const block = object(raw);
    if (string2(block["type"]) !== "tool_result") continue;
    any = true;
    const use = string2(block["tool_use_id"]);
    const doing = state.tools.get(use);
    if (doing === void 0) continue;
    state.tools.delete(use);
    const said = resultText(block["content"]);
    const failed = block["is_error"] === true;
    const task = state.tasks.get(state.uses.get(use) ?? "");
    if (task !== void 0) {
      const output = string2(object(message["tool_use_result"])["outputFile"]) || WRITES_TO.exec(said)?.[1];
      if (output !== void 0 && output !== "") keepTask(state, out, { ...task, output });
    }
    if (doing.tool === "AskUserQuestion") {
      const answers = object(object(message["tool_use_result"] ?? message["toolUseResult"])["answers"]);
      for (const [index, wanted] of questionsFromClaude(doing.input).entries()) {
        const answer = wanted.kind === "question" ? string2(answers[wanted.question]) : "";
        out.items.push({
          kind: "card",
          id: cardId(askId(use, index)),
          card: { ...cardFor(wanted, state.root), answered: answeredLine(wanted, answer || "Nothing", state.root) }
        });
      }
      continue;
    }
    if (doing.tool === "ExitPlanMode") {
      const wanted = wantedFromClaude(doing.tool, doing.input);
      out.items.push({
        kind: "card",
        id: cardId(use),
        card: { ...cardFor(wanted, state.root), answered: answeredLine(wanted, failed ? "no" : "once", state.root) }
      });
      continue;
    }
    if (failed && said.includes(AGAIN)) {
      out.gone.push(use);
      continue;
    }
    if (failed && refused(said)) {
      const wanted = wantedFromClaude(doing.tool, doing.input);
      out.gone.push(use);
      out.items.push({
        kind: "card",
        id: cardId(use),
        card: { ...cardFor(wanted, state.root), answered: answeredLine(wanted, "no", state.root) }
      });
      continue;
    }
    if (doing.item.what === "") continue;
    if (WRITES.has(doing.tool) && !failed) {
      const path = string2(doing.input["file_path"]) || string2(doing.input["notebook_path"]);
      for (const file of filesAmong(state.root, [path])) {
        if (!state.wrote.includes(file)) state.wrote = [...state.wrote, file];
      }
    }
    const moved = COMMANDS.has(doing.tool) && object(message["tool_use_result"])["backgroundedByUser"] === true;
    const detail = COMMANDS.has(doing.tool) ? clipped(`$ ${string2(doing.input["command"])}
${said}`.trimEnd()) : WRITES.has(doing.tool) || doing.tool === "Read" ? failed ? clipped(said) : void 0 : said === "" ? void 0 : clipped(said);
    const pictures = picturesIn(block["content"], state.budget);
    const { live: _live, ...rest } = doing.item;
    out.items.push({
      ...rest,
      ...moved ? { what: movedLine(doing.input, state.root) } : {},
      ...detail === void 0 ? {} : { detail },
      ...pictures.length === 0 ? {} : { images: pictures }
    });
  }
  return any;
}
function contextOf(entry) {
  const usage = object(object(entry["message"])["usage"]);
  const count = (key) => typeof usage[key] === "number" ? usage[key] : 0;
  const used = count("input_tokens") + count("cache_creation_input_tokens") + count("cache_read_input_tokens") + count("output_tokens");
  return used === 0 ? void 0 : used;
}
function lastContext(entries) {
  for (const entry of [...entries].reverse()) {
    if (string2(entry["type"]) !== "assistant" || entry["isSidechain"] === true) continue;
    if (string2(object(entry["message"])["model"]) === "<synthetic>") continue;
    const used = contextOf(entry);
    if (used !== void 0) return used;
  }
  return void 0;
}
function costOf(entries) {
  const runs = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const total = entry["totalCostUSD"];
    if (string2(entry["type"]) === "cost-state" && typeof total === "number") runs.set(entry["startTime"], total);
  }
  return runs.size === 0 ? void 0 : [...runs.values()].reduce((sum, run) => sum + run, 0);
}
function planWindow(value) {
  const window = object(value);
  const part = window["utilization"];
  const at = window["resetsAt"];
  return typeof part === "number" && typeof at === "number" ? { part, resetsAt: at * 1e3 } : void 0;
}
function plan(fiveHour, sevenDay) {
  if (fiveHour === void 0 && sevenDay === void 0) return void 0;
  return { ...fiveHour === void 0 ? {} : { fiveHour }, ...sevenDay === void 0 ? {} : { sevenDay } };
}
function readClaude(state, message) {
  const out = empty();
  const type = string2(message["type"]);
  if (message["parent_tool_use_id"] !== void 0 && message["parent_tool_use_id"] !== null) {
    return out;
  }
  if (type === "system") {
    const subtype = string2(message["subtype"]);
    if (subtype === "init") {
      const model = string2(message["model"]);
      const mode = string2(message["permissionMode"]);
      out.signals.push({
        kind: "started",
        session: string2(message["session_id"]),
        // 'none' on a plan. A build that does not say is not taken for a key.
        key: !["", "none"].includes(string2(message["apiKeySource"])),
        ...model === "" ? {} : { model },
        ...mode === "" ? {} : { mode }
      });
    } else if (subtype === "compact_boundary") {
      state.seq += 1;
      state.summarised = `summarised:${String(state.seq)}`;
      out.items.push({ kind: "note", id: state.summarised, note: "summarised", text: SUMMARISED });
      const left = object(message["compact_metadata"])["post_tokens"];
      if (typeof left === "number") out.signals.push({ kind: "spend", used: left });
    } else if (subtype === "status" && string2(message["permissionMode"]) !== "") {
      out.signals.push({ kind: "mode", mode: string2(message["permissionMode"]) });
    } else if (subtype === "background_tasks_changed") {
      for (const raw of list(message["tasks"])) {
        const listed = object(raw);
        const id = string2(listed["task_id"]);
        if (state.backgrounded.has(id) && state.tasks.has(id)) continue;
        state.backgrounded.add(id);
        const kind = string2(listed["task_type"]);
        keepTask(
          state,
          out,
          state.tasks.get(id) ?? { id, kind, what: string2(listed["description"]), status: "running", started: Date.now() }
        );
      }
    } else if (subtype === "task_started") {
      const id = string2(message["task_id"]);
      const use = string2(message["tool_use_id"]);
      const doing = state.tools.get(use);
      const command = string2(doing?.input["command"]);
      state.uses.set(use, id);
      if (message["is_backgrounded"] === true) state.backgrounded.add(id);
      keepTask(state, out, {
        started: Date.now(),
        ...state.tasks.get(id),
        id,
        kind: doing?.tool === "Monitor" ? "monitor" : string2(message["task_type"]),
        what: string2(message["description"]),
        status: "running",
        ...command === "" ? {} : { command },
        ...use === "" ? {} : { use }
      });
      if (message["is_backgrounded"] !== true && doing !== void 0 && COMMANDS.has(doing.tool)) {
        const line = claudeLine(doing.tool, doing.input, state.root);
        if (line !== void 0) out.items.push({ ...doing.item, what: sentence(line.doing), live: true, lasting: true });
      }
    } else if (subtype === "task_updated") {
      const id = string2(message["task_id"]);
      const patch = object(message["patch"]);
      const task = state.tasks.get(id);
      const ended = ENDED[string2(patch["status"])];
      if (patch["is_backgrounded"] === true) state.backgrounded.add(id);
      if (task !== void 0) {
        const end = typeof patch["end_time"] === "number" ? patch["end_time"] : Date.now();
        keepTask(state, out, ended === void 0 ? task : { ...task, status: ended, ended: task.ended ?? end });
      }
    } else if (subtype === "task_progress") {
      const task = state.tasks.get(string2(message["task_id"]));
      const usage = object(message["usage"]);
      const count = (key) => typeof usage[key] === "number" ? usage[key] : 0;
      if (task !== void 0) {
        const progress = { doing: string2(message["description"]), tools: count("tool_uses"), tokens: count("total_tokens") };
        keepTask(state, out, { ...task, progress });
      }
    } else if (subtype === "task_notification") {
      const id = string2(message["task_id"]);
      const task = state.tasks.get(id);
      const summary = string2(message["summary"]);
      if (state.backgrounded.has(id)) {
        const note = taskNote(id, string2(message["status"]), summary);
        if (note !== void 0) out.items.push(note);
      }
      if (!state.backgrounded.has(id)) state.tasks.delete(id);
      else if (task !== void 0) {
        const output = string2(message["output_file"]);
        const exit = /\(exit code (-?\d+)\)/.exec(summary)?.[1];
        keepTask(state, out, {
          ...task,
          status: ENDED[string2(message["status"])] ?? task.status,
          ended: task.ended ?? Date.now(),
          ...output === "" ? {} : { output },
          ...exit === void 0 ? {} : { exit: Number(exit) }
        });
      }
    }
    return out;
  }
  if (type === "stream_event") {
    const event = object(message["event"]);
    const kind = string2(event["type"]);
    if (kind === "content_block_start" && string2(object(event["content_block"])["type"]) === "text") {
      state.seq += 1;
      state.open = `growing:${String(state.seq)}`;
      state.grown = "";
    } else if (kind === "content_block_delta" && state.open !== void 0) {
      const delta = object(event["delta"]);
      if (string2(delta["type"]) === "text_delta") {
        state.grown += string2(delta["text"]);
        if (state.grown.trim() !== "") out.items.push({ kind: "theirs", id: state.open, text: state.grown });
      }
    }
    return out;
  }
  if (type === "assistant") {
    assistantBlocks(state, message, out);
    const used = string2(object(message["message"])["model"]) === "<synthetic>" ? void 0 : contextOf(message);
    if (used !== void 0) out.signals.push({ kind: "spend", used });
    return out;
  }
  if (type === "user") {
    if (toolResults(state, message, out)) return out;
    const content = object(message["message"])["content"];
    const said = typeof content === "string" ? content : resultText(content);
    if (state.summarised !== void 0 && (message["isCompactSummary"] === true || message["isSynthetic"] === true)) {
      out.items.push({ kind: "note", id: state.summarised, note: "summarised", text: SUMMARISED, detail: said.replace(SUMMARY_HEAD, "").trim() });
      state.summarised = void 0;
      return out;
    }
    if (INTERRUPTED.test(said)) state.interrupted = true;
    const held = HELD.exec(said);
    if (held !== null) out.signals.push({ kind: "held", hook: held[1] ?? "", reason: (held[2] ?? "").trim() });
    return out;
  }
  if (type === "rate_limit_event") {
    const info = object(message["rate_limit_info"]);
    const windows = object(info["unifiedWindows"]);
    const said = plan(planWindow(windows["five_hour"]), planWindow(windows["seven_day"]));
    if (said !== void 0) out.signals.push({ kind: "plan", plan: said });
    if (string2(info["status"]) === "rejected") {
      const at = typeof info["resetsAt"] === "number" ? info["resetsAt"] * 1e3 : void 0;
      state.limit = at === void 0 ? {} : { resetsAt: at };
    }
    return out;
  }
  if (type === "control_request") {
    const request = object(message["request"]);
    if (string2(request["subtype"]) !== "can_use_tool") return out;
    const tool = string2(request["tool_name"]);
    const input = object(request["input"]);
    out.signals.push({
      kind: "asks",
      request: {
        request: string2(message["request_id"]),
        tool,
        toolUse: string2(request["tool_use_id"]),
        input,
        suggestions: list(request["permission_suggestions"]).map(object),
        wanted: wantedFromClaude(tool, input)
      }
    });
    return out;
  }
  if (type === "result") {
    const cost = message["total_cost_usd"];
    if (typeof cost === "number") out.signals.push({ kind: "spend", cost });
    for (const doing of state.tools.values()) {
      if (doing.item.what === "") continue;
      const { live: _live, ...rest } = doing.item;
      out.items.push(rest);
    }
    state.tools.clear();
    if (state.open !== void 0) {
      out.gone.push(state.open);
      state.open = void 0;
    }
    const failed = message["is_error"] === true;
    const said = state.synthetic ?? string2(message["result"]);
    const stopped = state.interrupted;
    const limit = state.limit;
    state.interrupted = false;
    state.synthetic = void 0;
    state.limit = void 0;
    if (stopped) {
      flush(state, out);
      out.signals.push({ kind: "ended", how: "stopped" });
    } else if (!failed && string2(message["subtype"]) === "success") {
      flush(state, out);
      out.signals.push({ kind: "ended", how: "done" });
    } else if (limit !== void 0 || LIMIT.test(said)) {
      flush(state, out);
      out.signals.push({
        kind: "ended",
        how: "limit",
        ...limit?.resetsAt === void 0 ? {} : { resetsAt: limit.resetsAt }
      });
    } else if (SIGNED_OUT.test(said)) {
      out.signals.push({ kind: "ended", how: "signedOut", text: said });
    } else {
      flush(state, out);
      out.signals.push({ kind: "ended", how: "failed", text: said });
    }
    return out;
  }
  return out;
}
var STILL_GOING = 6e4;
var goalStatus = (entry) => {
  const said = object(entry["attachment"]);
  return string2(entry["type"]) === "attachment" && string2(said["type"]) === "goal_status" ? said : void 0;
};
function goalNote(entry) {
  const said = goalStatus(entry);
  if (said === void 0 || said["sentinel"] === true || said["met"] !== true && said["failed"] !== true) return void 0;
  const reason = string2(said["reason"]);
  return {
    kind: "note",
    id: "",
    note: "goal",
    text: goalEnded(string2(said["condition"]), said["met"] === true),
    ...reason === "" ? {} : { detail: reason }
  };
}
function goalOf(entries) {
  let goal;
  let ended;
  let met = false;
  for (const entry of entries) {
    const said = goalStatus(entry);
    if (said === void 0) continue;
    const reason = string2(said["reason"]);
    if (said["met"] === true || said["failed"] === true) {
      goal = void 0;
      ended = goalNote(entry);
      met = said["met"] === true;
    } else if (said["sentinel"] === true) {
      goal = { condition: string2(said["condition"]), checks: 0 };
      ended = void 0;
    } else if (goal !== void 0) {
      goal = { condition: goal.condition, checks: goal.checks + 1, ...reason === "" ? {} : { reason } };
    }
  }
  return { ...goal === void 0 ? {} : { goal }, ...ended === void 0 ? {} : { ended, met } };
}
function tasksOf(entries) {
  const tools = /* @__PURE__ */ new Map();
  const tasks = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (entry["isSidechain"] === true) continue;
    const at = Date.parse(string2(entry["timestamp"]));
    const type = string2(entry["type"]);
    const content = object(entry["message"])["content"];
    if (type === "assistant") {
      for (const block of list(content)) {
        const use = object(block);
        if (string2(use["type"]) === "tool_use") {
          tools.set(string2(use["id"]), { tool: string2(use["name"]), input: object(use["input"]), at });
        }
      }
      continue;
    }
    if (type !== "user") continue;
    const id = string2(object(entry["toolUseResult"])["backgroundTaskId"]);
    if (id !== "") {
      const result = list(content).map(object).find((block) => string2(block["type"]) === "tool_result");
      const use = string2(result?.["tool_use_id"]);
      const started = tools.get(use);
      const command = string2(started?.input["command"]);
      const began = started?.at ?? at;
      tasks.set(id, {
        id,
        kind: started?.tool === "Monitor" ? "monitor" : started?.tool === "Agent" ? "local_agent" : "local_bash",
        what: string2(started?.input["description"]),
        ...command === "" ? {} : { command },
        ...use === "" ? {} : { use },
        status: "running",
        started: Number.isNaN(began) ? 0 : began
      });
      continue;
    }
    for (const text2 of textsOf(content)) {
      const told = TASK_NOTIFICATION.exec(text2);
      if (told === null) continue;
      const body = told[1] ?? "";
      const task = tasks.get(tagged(body, "task-id"));
      if (task === void 0) continue;
      const output = tagged(body, "output-file");
      const exit = /exit code (-?\d+)/.exec(tagged(body, "summary"))?.[1];
      tasks.set(task.id, {
        ...task,
        status: ENDED[tagged(body, "status")] ?? "completed",
        ended: Number.isNaN(at) ? task.started : at,
        ...output === "" ? {} : { output },
        ...exit === void 0 ? {} : { exit: Number(exit) }
      });
    }
  }
  return [...tasks.values()].map(
    (task) => task.status === "running" ? { ...task, status: "stopped", ended: task.started } : task
  );
}
function replayClaude(root, entries, quietFor) {
  const state = claudeState(root);
  const budget = state.budget;
  const items = /* @__PURE__ */ new Map();
  const take = (read2) => {
    for (const id of read2.gone) items.delete(id);
    for (const item of read2.items) items.set(item.id, item);
  };
  let open32 = false;
  let shell;
  for (const entry of entries) {
    const type = string2(entry["type"]);
    if (entry["isSidechain"] === true || entry["isMeta"] === true) continue;
    if (type === "user") {
      const content = object(entry["message"])["content"];
      const typed2 = typeof content === "string" || !list(content).some((block) => string2(object(block)["type"]) === "tool_result");
      if (!typed2) {
        take(readClaude(state, { ...entry, tool_use_result: entry["toolUseResult"] }));
        continue;
      }
      if (entry["isCompactSummary"] === true) {
        take(readClaude(state, entry));
        continue;
      }
      const words = [];
      for (const [index, text2] of textsOf(content).entries()) {
        const told = TASK_NOTIFICATION.exec(text2);
        if (told !== null) {
          const body = told[1] ?? "";
          const note = taskNote(tagged(body, "task-id"), tagged(body, "status"), tagged(body, "summary"));
          if (note !== void 0) items.set(note.id, note);
          continue;
        }
        const input = BASH_INPUT.exec(text2);
        const output = BASH_OUTPUT.exec(text2);
        if (input === null && output === null) {
          words.push(text2);
          continue;
        }
        const out3 = empty();
        flush(state, out3);
        take(out3);
        const was = shell === void 0 ? void 0 : items.get(shell);
        if (output !== null && was?.kind === "shell") {
          const printed2 = [output[1] ?? "", output[2] ?? ""].filter((one) => one.trim() !== "").map((one) => one.replace(/\n+$/, "")).join("\n");
          items.set(was.id, { ...was, output: printed2.trim() === "(Bash completed with no output)" ? "" : printed2 });
          shell = void 0;
        } else if (input !== null) {
          shell = `${string2(entry["uuid"])}:shell:${String(index)}`;
          items.set(shell, { kind: "shell", id: shell, command: (input[1] ?? "").trim(), output: "", ...stamped(entry) });
        }
      }
      const written = words.join("\n");
      const command = tagged(written, "command-name");
      const said = command.startsWith("/") ? `${command} ${tagged(written, "command-args")}`.trim() : written;
      const pictures = picturesIn(content, budget);
      if (NOT_SAID.test(said)) continue;
      if (said.trim() === "" && pictures.length === 0) continue;
      const out2 = empty();
      flush(state, out2);
      take(out2);
      if (INTERRUPTED.test(said)) {
        items.set(`stopped:${string2(entry["uuid"])}`, {
          kind: "note",
          id: `stopped:${string2(entry["uuid"])}`,
          note: "stopped",
          text: STOPPED
        });
        open32 = false;
        continue;
      }
      items.set(string2(entry["uuid"]), {
        kind: "mine",
        id: string2(entry["uuid"]),
        text: said,
        ...pictures.length === 0 ? {} : { images: pictures },
        ...stamped(entry)
      });
      open32 = true;
      continue;
    }
    if (type === "assistant") {
      const inner = object(entry["message"]);
      const blocks = list(inner["content"]).map(object);
      open32 = !(string2(inner["stop_reason"]) === "end_turn" || blocks.every((block) => string2(block["type"]) === "text"));
      take(readClaude(state, entry));
      continue;
    }
    if (type === "system" && string2(entry["subtype"]) === "compact_boundary") take(readClaude(state, entry));
    const ended = goalNote(entry);
    if (ended !== void 0) {
      state.seq += 1;
      items.set(`goal:${String(state.seq)}`, { ...ended, id: `goal:${String(state.seq)}` });
    }
  }
  const out = empty();
  for (const doing of state.tools.values()) {
    if (doing.item.what === "") continue;
    const { live: _live, ...rest } = doing.item;
    out.items.push(rest);
  }
  flush(state, out);
  take(out);
  if (open32 && quietFor > STILL_GOING) {
    items.set("stopped:end", { kind: "note", id: "stopped:end", note: "stopped", text: STOPPED });
  }
  return [...items.values()];
}
function lastSaid(entries) {
  for (const entry of [...entries].reverse()) {
    if (string2(entry["type"]) !== "assistant" || entry["isSidechain"] === true) continue;
    const content = object(entry["message"])["content"];
    if (!Array.isArray(content)) continue;
    const text2 = content.map((block) => string2(object(block)["type"]) === "text" ? string2(object(block)["text"]) : "").join("\n");
    if (text2.trim() !== "") return saidLine(text2);
  }
  return "";
}
function saidIn(entry) {
  if (string2(entry["type"]) === "assistant" && entry["isSidechain"] !== true) {
    return textsOf(object(entry["message"])["content"]).join("\n");
  }
  return typed(entry);
}
function typed(entry) {
  if (string2(entry["type"]) !== "user" || entry["isSidechain"] === true || entry["isMeta"] === true) return "";
  if (entry["isCompactSummary"] === true) return "";
  const content = object(entry["message"])["content"];
  if (list(content).some((block) => string2(object(block)["type"]) === "tool_result")) return "";
  return textsOf(content).filter((text2) => !/^\s*(<|\[Request interrupted|Caveat:)/.test(text2)).join("\n");
}
var PATIENCE = 2e4;
var string3 = (value) => typeof value === "string" ? value : void 0;
var browsersOf = (answer) => (Array.isArray(answer["browsers"]) ? answer["browsers"] : []).flatMap((one) => {
  const browser = one ?? {};
  const id = string3(browser["device_id"]);
  return id === void 0 ? [] : [{ id, name: string3(browser["name"]) ?? id, current: browser["current"] === true }];
});
function readBrowsers(root, pick) {
  return new Promise((done) => {
    const child = spawn(
      claudeCommand(),
      [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--chrome",
        "--no-session-persistence",
        "--settings",
        JSON.stringify({ disableAllHooks: true })
      ],
      { cwd: root, stdio: ["pipe", "pipe", "ignore"], env: planOnly(), windowsHide: true }
    );
    let browsers;
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      clearTimeout(patience);
      child.stdin.end();
      child.kill();
      done(browsers);
    };
    const patience = setTimeout(finish, PATIENCE);
    const ask = (id, request) => {
      child.stdin.write(`${JSON.stringify({ type: "control_request", request_id: id, request })}
`);
    };
    createInterface({ input: child.stdout }).on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message["type"] !== "control_response") return;
      const response = message["response"] ?? {};
      if (response["request_id"] === "pick") return ask("list", { subtype: "get_chrome_browsers" });
      if (response["request_id"] !== "list" || response["subtype"] !== "success") return finish();
      browsers = browsersOf(response["response"] ?? {});
      finish();
    });
    child.on("error", finish);
    child.on("close", finish);
    child.stdin.on("error", () => void 0);
    if (pick === void 0) ask("list", { subtype: "get_chrome_browsers" });
    else ask("pick", { subtype: "select_chrome_browser", device_id: pick });
  });
}
var NAMED = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
var BARE = /https?:\/\/[^\s<>"'`)\]]+/g;
var TRAILING = /[.,;:!?]+$/;
function linksInText(texts) {
  const found = /* @__PURE__ */ new Map();
  for (const said of [...texts].reverse()) {
    for (const [, text2 = "", url = ""] of said.matchAll(NAMED)) {
      const had = found.get(url);
      if (had === void 0 || had.text === void 0) found.set(url, text2 === url ? { url } : { url, text: text2 });
    }
    for (const [bare] of said.matchAll(BARE)) {
      const url = bare.replace(TRAILING, "");
      if (!found.has(url)) found.set(url, { url });
    }
  }
  return [...found.values()];
}
var GITHUB = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/;
var LINEAR = /https:\/\/linear\.app\/[\w-]+\/issue\/([A-Z][A-Z0-9]*-\d+)[^\s)>\]]*/;
var JIRA = /https:\/\/[\w-]+\.atlassian\.net\/browse\/([A-Z][A-Z0-9]*-\d+)/;
function workItem(text2) {
  const found = [GITHUB, LINEAR, JIRA].map((pattern) => pattern.exec(text2)).filter((match) => match !== null).sort((one, other) => one.index - other.index)[0];
  if (found === void 0) return void 0;
  const [url, first = "", repo, kind, number] = found;
  if (number !== void 0) {
    return { label: `#${number}`, url, says: `${first}/${repo ?? ""} ${kind === "pull" ? "pull request" : "issue"} ${number}` };
  }
  return { label: first, url, says: first };
}
var string4 = (value) => typeof value === "string" ? value : "";
var slug = (root) => root.replace(/[^A-Za-z0-9]/g, "-");
var base = () => join2(process.env["CLAUDE_CONFIG_DIR"] ?? join2(homedir3(), ".claude"), "projects");
async function names(root) {
  const real = await realpath(root).catch(() => root);
  return [.../* @__PURE__ */ new Set([root, real])];
}
async function folders(root) {
  return (await names(root)).map((path) => join2(base(), slug(path)));
}
async function claudeFile(root, id) {
  if (!/^[A-Za-z0-9-]+$/.test(id)) return void 0;
  for (const folder of await folders(root)) {
    const path = join2(folder, `${id}.jsonl`);
    const there = await stat(path).then(
      (found) => found.isFile(),
      () => false
    );
    if (there) return path;
  }
  return void 0;
}
var EDGE = 64 * 1024;
var MOST2 = 200;
function linesIn(bytes, from, size, keepCut) {
  const whole = bytes.toString("utf8").split("\n");
  if (from > 0) whole.shift();
  if (from + bytes.length < size && from === 0) keepCut(whole.pop() ?? "");
  else if (from + bytes.length < size) whole.pop();
  return whole.flatMap((line) => {
    try {
      return line.trim() === "" ? [] : [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}
function edgesOf(head, tail, size) {
  let cut = "";
  const keep = (line) => {
    cut = line;
  };
  if (tail === void 0 || size <= EDGE * 2) return { head: linesIn(head, 0, size, keep), tail: [], cut };
  const first = linesIn(head, 0, size, keep);
  return { head: first, tail: linesIn(tail, size - tail.length, size, keep), cut };
}
async function edges(path, size) {
  const file = await open(path, "r");
  try {
    const part = async (from, length) => {
      const { buffer, bytesRead } = await file.read(Buffer.alloc(length), 0, length, from);
      return buffer.subarray(0, bytesRead);
    };
    if (size <= EDGE * 2) return edgesOf(await part(0, size), void 0, size);
    return edgesOf(await part(0, EDGE), await part(size - EDGE, EDGE), size);
  } finally {
    await file.close();
  }
}
function cutWords(line) {
  if (!line.includes('"type":"user"') || line.includes('"isSidechain":true') || line.includes('"isMeta":true')) return "";
  const found = /"content":\[\{"type":"text","text":("(?:[^"\\]|\\.)*")/.exec(line)?.[1];
  if (found === void 0) return "";
  const words = string4(JSON.parse(found));
  return /^\s*(<|\[Request interrupted|Caveat:)/.test(words) ? "" : words;
}
async function deleteClaude(root, id) {
  const path = await claudeFile(root, id);
  if (path === void 0) return false;
  await rm(path, { force: true });
  await rm(path.slice(0, -".jsonl".length), { recursive: true, force: true });
  return true;
}
async function filesIn(folder) {
  const files = [];
  for (const name of await readdir(folder).catch(() => [])) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join2(folder, name);
    const found = await stat(path).catch(() => void 0);
    if (found?.isFile() !== true || found.size === 0) continue;
    files.push({ id: name.slice(0, -".jsonl".length), path, at: found.mtimeMs, size: found.size });
  }
  return files;
}
var within2 = (path, folder) => path === folder || path.startsWith(`${folder}/`);
async function listClaude(root) {
  const heads = await names(root);
  const own = heads.map(slug);
  const near = (await readdir(base()).catch(() => [])).filter((name) => own.some((one) => name.startsWith(`${one}-`)));
  const files = [
    ...(await Promise.all(own.map((name) => filesIn(join2(base(), name))))).flat(),
    ...(await Promise.all(near.map(async (name) => (await filesIn(join2(base(), name))).map((file) => ({ ...file, near: true }))))).flat()
  ];
  const below = (cwd) => cwd !== void 0 && !heads.includes(cwd) && heads.some((head) => within2(cwd, head)) ? cwd : void 0;
  const found = await rowsOf(files, (row, file) => !("near" in file) || below(row.cwd) !== void 0, MOST2);
  return found.map((row) => {
    const at = below(row.cwd);
    return at === void 0 ? row : { ...row, below: at };
  });
}
var TEMPORARY = ["/private/tmp/", "/private/var/folders/", "/tmp/", "/var/folders/"];
async function everyClaude(from, to, wanted) {
  const temporary = TEMPORARY.map((path) => slug(path));
  const kept2 = (await readdir(base()).catch(() => [])).filter((name) => !temporary.some((one) => name.startsWith(one)));
  const files = (await Promise.all(kept2.map((name) => filesIn(join2(base(), name))))).flat().filter((file) => file.at >= from && file.at < to && wanted(file.id));
  return rowsOf(files, (row) => row.cwd !== void 0 && !TEMPORARY.some((path) => `${row.cwd ?? ""}/`.startsWith(path)), Infinity);
}
async function rowsOf(files, kept2, most) {
  files.sort((one, other) => other.at - one.at);
  const found = [];
  for (const file of files) {
    if (found.length >= most) break;
    const row = rowFrom(file, await edges(file.path, file.size).catch(() => ({ head: [], tail: [], cut: "" })));
    if (row !== void 0 && kept2(row, file)) found.push(row);
  }
  return found;
}
function rowFrom(file, { head, tail, cut }) {
  const all = [...head, ...tail];
  const named = (type, key) => string4([...all].reverse().find((entry) => string4(entry["type"]) === type)?.[key]);
  const asked = head.map(typed).find((words) => words.trim() !== "") || cutWords(cut);
  const said = asked || (tail.map(typed).find((words) => words.trim() !== "") ?? "");
  const title = named("custom-title", "customTitle") || named("ai-title", "aiTitle") || firstLine(said, 80);
  if (title === "") return void 0;
  const entrypoint = string4(all.find((entry) => string4(entry["entrypoint"]) !== "")?.["entrypoint"]);
  const model = [...all].reverse().map(
    (entry) => string4(entry["type"]) === "assistant" ? string4((entry["message"] ?? {})["model"]) : ""
  ).find((name) => name !== "" && name !== "<synthetic>");
  const used = lastContext(tail.length > 0 ? tail : head);
  const work = workItem(asked);
  const cwd = string4(all.find((entry) => string4(entry["cwd"]) !== "")?.["cwd"]);
  return {
    id: file.id,
    title,
    stands: lastSaid(tail.length > 0 ? tail : head) || firstLine(named("last-prompt", "lastPrompt")),
    at: file.at,
    driven: entrypoint.startsWith("sdk"),
    ...model === void 0 ? {} : { model },
    ...used === void 0 ? {} : { used },
    ...work === void 0 ? {} : { work },
    ...cwd === "" ? {} : { cwd }
  };
}
var CHUNK = 2 * 1024 * 1024;
async function entriesOf(path, wanted = () => true) {
  const entries = [];
  const take = (line) => {
    if (line.trim() === "" || !wanted(line)) return;
    try {
      entries.push(JSON.parse(line));
    } catch {
    }
  };
  const file = await open(path, "r");
  try {
    let carry = Buffer.alloc(0);
    for (; ; ) {
      const { buffer, bytesRead } = await file.read(Buffer.alloc(CHUNK), 0, CHUNK, null);
      if (bytesRead === 0) break;
      const joined = Buffer.concat([carry, buffer.subarray(0, bytesRead)]);
      const end = joined.lastIndexOf(10);
      if (end < 0) {
        carry = joined;
        continue;
      }
      for (const line of joined.subarray(0, end).toString("utf8").split("\n")) take(line);
      carry = joined.subarray(end + 1);
    }
    take(carry.toString("utf8"));
  } finally {
    await file.close();
  }
  return entries;
}
var kept = /* @__PURE__ */ new Map();
var KEEP = 8;
async function readClaudeSession(root, id) {
  const path = await claudeFile(root, id);
  return path === void 0 ? void 0 : readSessionAt(path, root);
}
async function readSessionAt(path, root) {
  const found = await stat(path);
  const was = kept.get(path);
  if (was !== void 0 && was.size === found.size && was.written === found.mtimeMs) return was.conversation;
  const entries = await entriesOf(path);
  const cost = costOf(entries);
  const { goal } = goalOf(entries);
  const quietFor = Date.now() - found.mtimeMs;
  const conversation = {
    items: replayClaude(root, entries, quietFor),
    tasks: tasksOf(entries),
    ...cost === void 0 ? {} : { cost },
    ...goal === void 0 ? {} : { goal }
  };
  kept.delete(path);
  if (quietFor > STILL_GOING) kept.set(path, { size: found.size, written: found.mtimeMs, conversation });
  if (kept.size > KEEP) kept.delete(kept.keys().next().value ?? "");
  return conversation;
}
var linked = /* @__PURE__ */ new Map();
async function readLinks(root, id) {
  const path = await claudeFile(root, id);
  return path === void 0 ? [] : linksAt(path);
}
async function linksAt(path) {
  const found = await stat(path);
  const was = linked.get(path);
  if (was !== void 0 && was.size === found.size && was.written === found.mtimeMs) return was.links;
  const entries = await entriesOf(path, (line) => line.includes("http"));
  const links = linksInText(entries.map(saidIn));
  linked.delete(path);
  linked.set(path, { size: found.size, written: found.mtimeMs, links });
  if (linked.size > LINKED) linked.delete(linked.keys().next().value ?? "");
  return links;
}
var LINKED = 2e3;
async function readGoal(root, id) {
  const path = await claudeFile(root, id);
  return path === void 0 ? {} : goalAt(path);
}
async function goalAt(path) {
  return goalOf(await entriesOf(path, (line) => line.includes('"goal_status"')));
}
async function forkPoint(root, id, at) {
  const path = await claudeFile(root, id);
  return path === void 0 ? void 0 : forkPointAt(path, at);
}
async function forkPointAt(path, at) {
  const said = (await entriesOf(path, (line) => line.includes('"uuid"'))).filter(
    (entry) => (entry["type"] === "user" || entry["type"] === "assistant") && entry["isSidechain"] !== true && typeof entry["uuid"] === "string" && Date.parse(String(entry["timestamp"])) <= at
  );
  const messageOf = (entry) => entry["message"]?.["id"];
  const calls = (entry) => {
    const content = entry["message"]?.["content"];
    return Array.isArray(content) && content.some((block) => block?.["type"] === "tool_use");
  };
  let end = said.length - 1;
  const last = said[end];
  if (last?.["type"] === "assistant" && said.some((entry) => entry["type"] === "assistant" && messageOf(entry) === messageOf(last) && calls(entry))) {
    while (end >= 0 && said[end]?.["type"] === "assistant" && messageOf(said[end]) === messageOf(last)) end -= 1;
  }
  const point = said[end]?.["uuid"];
  return typeof point === "string" ? point : void 0;
}
var PATIENCE2 = 2e4;
var AGAIN2 = 500;
var serversOf = (answer) => (Array.isArray(answer["mcpServers"]) ? answer["mcpServers"] : []).flatMap((one) => {
  const server = one ?? {};
  return typeof server["name"] === "string" ? [{ name: server["name"], status: typeof server["status"] === "string" ? server["status"] : "" }] : [];
});
var MCP_ARGS = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--no-session-persistence",
  "--settings",
  JSON.stringify({ disableAllHooks: true })
];
function readMcp(root, change, launch) {
  return new Promise((done) => {
    const child = launch?.() ?? spawn2(claudeCommand(), MCP_ARGS, { cwd: root, stdio: ["pipe", "pipe", "ignore"], env: planOnly(), windowsHide: true });
    let servers;
    let over = false;
    let soon;
    const finish = () => {
      if (over) return;
      over = true;
      clearTimeout(patience);
      clearTimeout(soon);
      child.stdin.end();
      child.kill();
      done(servers);
    };
    const patience = setTimeout(finish, PATIENCE2);
    const ask = (id, request) => {
      child.stdin.write(`${JSON.stringify({ type: "control_request", request_id: id, request })}
`);
    };
    createInterface2({ input: child.stdout }).on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message["type"] !== "control_response") return;
      const response = message["response"] ?? {};
      if (response["request_id"] === "change") return ask("status", { subtype: "mcp_status" });
      if (response["request_id"] !== "status" || response["subtype"] !== "success") return finish();
      servers = serversOf(response["response"] ?? {});
      if (servers.some((one) => one.status === "pending")) {
        soon = setTimeout(() => ask("status", { subtype: "mcp_status" }), AGAIN2);
      } else finish();
    });
    child.on("error", finish);
    child.on("close", finish);
    child.stdin.on("error", () => void 0);
    if (change === void 0) ask("status", { subtype: "mcp_status" });
    else ask("change", { subtype: "mcp_toggle", serverName: change.name, enabled: change.enabled });
  });
}
var string5 = (value) => typeof value === "string" ? value : "";
var PATIENCE3 = 15e3;
function claudeModelsFrom(answer) {
  const listed = answer["models"];
  if (!Array.isArray(listed)) return void 0;
  const unusable = answer["unavailable_models"];
  const models = [];
  for (const [raw, off] of [
    ...listed.map((one) => [one, false]),
    ...Array.isArray(unusable) ? unusable.map((one) => [one, true]) : []
  ]) {
    const one = raw ?? {};
    const value = string5(one["value"]);
    if (value === "" || value === "default") continue;
    const says = string5(one["description"]);
    const disabled = off || one["disabled"] === true;
    const id = disabled ? "" : string5(one["resolvedModel"]);
    const version = modelVersion(id);
    const contextWindow = one["contextWindow"];
    const maxOutputTokens = one["maxOutputTokens"];
    models.push({
      value,
      name: string5(one["displayName"]) || value,
      ...says === "" ? {} : { says },
      ...id === "" ? {} : { id },
      ...version === void 0 ? {} : { version },
      ...typeof contextWindow === "number" && contextWindow > 0 ? { contextWindow } : {},
      ...typeof maxOutputTokens === "number" && maxOutputTokens > 0 ? { maxOutputTokens } : {},
      ...!disabled && typeof one["supportsAdaptiveThinking"] === "boolean" ? { supportsAdaptiveThinking: one["supportsAdaptiveThinking"] } : {},
      ...!disabled && typeof one["supportsFastMode"] === "boolean" ? { supportsFastMode: one["supportsFastMode"] } : {},
      ...!disabled && typeof one["supportsAutoMode"] === "boolean" ? { supportsAutoMode: one["supportsAutoMode"] } : {},
      ...disabled ? { disabled: true } : {}
    });
  }
  return models;
}
function claudeModels() {
  return new Promise((done) => {
    const child = spawn3(
      claudeCommand(),
      ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"],
      { cwd: homedir4(), stdio: ["pipe", "pipe", "ignore"], env: planOnly(), windowsHide: true }
    );
    let over = false;
    const finish = (models) => {
      if (over) return;
      over = true;
      clearTimeout(patience);
      child.stdin.end();
      child.kill();
      done(models);
    };
    const patience = setTimeout(() => finish(void 0), PATIENCE3);
    createInterface3({ input: child.stdout }).on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message["type"] !== "control_response") return;
      const response = message["response"] ?? {};
      finish(response["subtype"] === "success" ? claudeModelsFrom(response["response"] ?? {}) : void 0);
    });
    child.on("error", () => finish(void 0));
    child.on("close", () => finish(void 0));
    child.stdin.on("error", () => void 0);
    child.stdin.write(
      `${JSON.stringify({ type: "control_request", request_id: "models", request: { subtype: "initialize" } })}
`
    );
  });
}
var CHUNK2 = 4 * 1024 * 1024;
var MOST3 = 50;
var AROUND = 60;
var SNIPPET = 160;
var read = /* @__PURE__ */ new Map();
var object2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
var string6 = (value) => typeof value === "string" ? value : "";
function saidIn2(entry) {
  if (entry["isSidechain"] === true) return "";
  const type = string6(entry["type"]);
  if (type === "user") {
    const words = typed(entry);
    if (words !== "") return words;
    const content2 = object2(entry["message"])["content"];
    if (!Array.isArray(content2) || content2.some((block) => string6(object2(block)["type"]) === "tool_result")) return "";
    return content2.map((block) => string6(object2(block)["type"]) === "text" ? string6(object2(block)["text"]) : "").join("\n");
  }
  if (type !== "assistant") return "";
  const content = object2(entry["message"])["content"];
  if (!Array.isArray(content)) return "";
  return content.map((block) => string6(object2(block)["type"]) === "text" ? string6(object2(block)["text"]) : "").join("\n");
}
async function readOn(path, from, to, said, codex) {
  const file = await open2(path, "r");
  try {
    let at = from;
    let carry = Buffer.alloc(0);
    while (at < to) {
      const length = Math.min(CHUNK2, to - at);
      const { buffer, bytesRead } = await file.read(Buffer.alloc(length), 0, length, at);
      if (bytesRead === 0) break;
      at += bytesRead;
      const joined = Buffer.concat([carry, buffer.subarray(0, bytesRead)]);
      const end = joined.lastIndexOf(10);
      if (end < 0) {
        carry = joined;
        continue;
      }
      for (const line of joined.subarray(0, end).toString("utf8").split("\n")) {
        if (codex ? !line.includes('"response_item"') : line.includes('"tool_use_id"') || !(line.includes('"type":"user"') || line.includes('"type":"assistant"'))) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        const text2 = (codex ? codexSaidIn(line) : saidIn2(entry)).trim();
        if (text2 !== "") said.push({ text: text2, lower: text2.toLowerCase() });
      }
      carry = joined.subarray(end + 1);
    }
    return at - carry.length;
  } finally {
    await file.close();
  }
}
function codexSaidIn(line) {
  const entry = JSON.parse(line);
  const payload = entry.payload;
  if (entry.type !== "response_item" || payload?.type !== "message" || !["user", "assistant"].includes(payload.role)) return "";
  return payload.content?.filter((one) => one.type === "input_text" || one.type === "output_text").map((one) => one.text ?? "").join("\n") ?? "";
}
async function brought(path, size, codex = false) {
  const was = read.get(path);
  const from = was === void 0 || size < was.size ? { size: 0, said: [] } : was;
  if (from.size === size) return from;
  const said = [...from.said];
  const now = { size: await readOn(path, from.size, size, said, codex), said };
  read.set(path, now);
  return now;
}
function snippet(said, words) {
  const text2 = plain(said.text);
  const lower = text2.toLowerCase();
  const first = Math.max(0, Math.min(...words.map((word) => lower.indexOf(word)).filter((at) => at >= 0)));
  const start = Math.max(0, text2.lastIndexOf(" ", Math.max(0, first - AROUND)) + 1);
  const cut = text2.slice(start, start + SNIPPET).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "..." : ""}${cut}${start + SNIPPET < text2.length ? "..." : ""}`;
}
var queue = Promise.resolve();
function searchClaude(roots, asked, foldersOf = folders) {
  const words = asked.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const run = async () => {
    const found = [];
    for (const root of roots) {
      for (const folder of await foldersOf(root)) {
        for (const name of await readdir2(folder).catch(() => [])) {
          if (!name.endsWith(".jsonl")) continue;
          const path = join3(folder, name);
          const file = await stat2(path).catch(() => void 0);
          if (file?.isFile() !== true) continue;
          const { said } = await brought(path, file.size).catch(() => ({ said: [] }));
          if (words.length === 0) continue;
          let count = 0;
          let last;
          for (const one of said) {
            if (!words.every((word) => one.lower.includes(word))) continue;
            count += 1;
            last = one;
          }
          if (last === void 0) continue;
          found.push({ id: name.slice(0, -".jsonl".length), root, count, said: snippet(last, words), at: file.mtimeMs });
        }
      }
    }
    return found.sort((one, other) => other.at - one.at).slice(0, MOST3).map(({ at: _at, ...hit }) => hit);
  };
  const searched = queue.then(run, run);
  queue = searched.catch(() => void 0);
  return searched;
}

// src/provider.mjs
var typingDelay = () => 15 + Math.floor(Math.random() * 31);
var object3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
var string7 = (value) => typeof value === "string" ? value : "";
var quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
var terminalArgs = (options, config) => [
  "--permission-mode",
  options.mode,
  "--settings",
  JSON.stringify({ claudeMdExcludes: [join4(config, "GECKIT.md")] }),
  ...options.model === void 0 ? [] : ["--model", options.model],
  ...options.resume ? ["--resume", options.id] : ["--session-id", options.id],
  ...options.resume || options.fork === void 0 ? [] : ["--fork-session", "--resume", options.fork.from, ...options.fork.at === void 0 ? [] : ["--resume-session-at", options.fork.at]]
];
var plain2 = (text2) => text2.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replaceAll("\xA0", " ");
function terminalScreen(text2) {
  const lines = plain2(text2).split("\n").map((line) => line.trimEnd());
  const trust = /Quick safety check:\s*Is this a project you created or one you trust\?/i.test(lines.join("\n")) && /Enter to confirm/i.test(text2);
  const trustFocus = lines.some((line) => /^\s*[❯›>]\s*No, exit\s*$/.test(line)) ? 0 : lines.some((line) => /^\s*[❯›>]\s*Yes, I trust this folder\s*$/.test(line)) ? 1 : -1;
  const selected = lines.findLastIndex((line) => /^\s*[❯›>]\s*\d+[.)]\s+/.test(line));
  if (selected !== -1 && /Enter to (?:select|confirm)|Esc to (?:cancel|go back)|↑.*↓|up.*down.*select/i.test(lines.slice(selected + 1).join("\n"))) {
    const choice = /^\s*(?:[❯›>]\s*)?(\d+)[.)]\s+(.+)$/;
    const groups = [];
    for (const [at, line] of lines.entries()) {
      const match = choice.exec(line);
      if (match === null) continue;
      const option = { at, number: Number(match[1]), label: match[2].trim() };
      if (option.number !== (groups.at(-1)?.at(-1)?.number ?? 0) + 1) groups.push([]);
      if (groups.length === 0) groups.push([]);
      groups.at(-1).push(option);
    }
    const group = groups.find((options2) => options2.some((option) => option.at === selected)) ?? [];
    const first = group[0]?.at ?? selected;
    const border = lines.slice(0, first).findLastIndex((line) => /^\s*[─━-]{3}/.test(line));
    const above = lines.slice(border + 1, first).filter((line) => line.trim() !== "");
    const title = above.slice(-6).map((line) => line.trim()).join("\n") || "Choose an option";
    const options = group.map(({ number, label }) => ({ number, label }));
    const focus = group.findIndex((option) => option.at === selected);
    const signature = JSON.stringify({ title, options });
    return { kind: "question", title, options, focus, signature, trust, trustFocus };
  }
  const busy = lines.some((line) => /^\s*[✻✽✶✳✢·*].*(?:…|\.\.\.|esc to interrupt|ctrl\+c to interrupt|escape to interrupt)/i.test(line));
  const prompt = lines.findLastIndex((line) => /^\s*[❯›>](?:\s|$)/.test(line) && !/^\s*[❯›>]\s*\d+[.)]/.test(line));
  const bordered = prompt > 0 && /^\s*[─━-]{3}/.test(lines[prompt - 1]) && /^\s*[─━-]{3}/.test(lines[prompt + 1] ?? "");
  return { kind: busy ? "working" : bordered ? "idle" : "unknown", trust, trustFocus };
}
function holdTmux(runtime, options, hear, left) {
  const { claudeCommand: claudeCommand2, OFF_PLAN: OFF_PLAN2, planOnly: planOnly2, claudeState: claudeState2, readClaude: readClaude2, claudeFile: claudeFile2 } = runtime;
  const environment = () => Object.fromEntries(Object.entries(planOnly2()).filter(([key]) => !key.startsWith("GECKIT_")));
  const tmux = (args, input) => new Promise((resolve2, reject) => {
    const child = execFile2("tmux", [...args], { env: environment(), windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(stderr.trim() || error.message));
      else resolve2(stdout.trim());
    });
    if (input !== void 0) child.stdin?.end(input);
  });
  if (process.platform === "win32" || options.root.startsWith("ssh://")) throw new Error("tmux mode is available for local macOS and Linux projects.");
  const name = `claude-${options.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const alive = () => tmux(["display-message", "-p", "-t", name, "#{pane_dead}"]).then((dead) => dead !== "1", () => false);
  const state = claudeState2(options.root);
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
  const emit = (items = [], gone = [], signals = []) => {
    if (!ended) hear({ items, gone, signals });
  };
  const read2 = async () => {
    const path = await claudeFile2(options.root, options.id);
    if (path === void 0) return;
    const size = (await stat3(path)).size;
    if (size < offset) {
      offset = 0;
      remainder = Buffer.alloc(0);
    }
    if (size === offset) return;
    const file = await open3(path, "r");
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
      const type = string7(entry["type"]);
      if (type === "cost-state") {
        const cost = entry["totalCostUSD"];
        if (typeof cost === "number") emit([], [], [{ kind: "spend", cost }]);
        continue;
      }
      if (type !== "assistant" && type !== "user" && type !== "system" && type !== "rate_limit_event") continue;
      const parsed = readClaude2(state, type === "user" ? { ...entry, tool_use_result: entry["toolUseResult"] } : entry);
      const model = type === "assistant" ? string7(object3(entry["message"])["model"]) : "";
      if (type === "assistant" && parsed.items.length > 0) activity = true;
      if (!turn && parsed.items.some((item) => item.kind === "theirs")) {
        turn = true;
        emit([], [], [{ kind: "begun" }]);
      }
      if (type === "assistant" && entry["isApiErrorMessage"] === true) {
        failure = string7(object3(entry["message"])["content"]?.find?.((part) => part.type === "text")?.text) || "Claude Code API request failed.";
        activity = true;
      } else if (model !== "" && model !== "<synthetic>") failure = "";
      emit(parsed.items, parsed.gone, [...parsed.signals.filter((signal) => signal.kind !== "ended" && signal.kind !== "asks"), ...model === "" || model === "<synthetic>" ? [] : [{ kind: "model", model }]]);
    }
  };
  const clearImages = async () => {
    if (imagesDirectory === void 0) return;
    const directory = imagesDirectory;
    imagesDirectory = void 0;
    await rm2(directory, { recursive: true, force: true });
  };
  const imagesIn = async (images) => {
    if (images.length === 0) return [];
    imagesDirectory ??= await mkdtemp(join4(tmpdir(), "claude-images-"));
    const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp" };
    const paths = [];
    for (const image of images) {
      const path = join4(imagesDirectory, `${randomUUID()}${extensions[image.media] ?? ".img"}`);
      await writeFile(path, Buffer.from(image.data, "base64"), { mode: 384, flag: "wx" });
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
    const text2 = await tmux(["capture-pane", "-p", "-t", name]);
    if (ended) return;
    const screen = terminalScreen(text2);
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
        if (!turn) {
          turn = true;
          emit([], [], [{ kind: "begun" }]);
        }
      }
      if (turn && screen.kind === "idle" && (activity || stopping) && remainder.length === 0) idle += 1;
      else idle = 0;
      if (idle >= 2) {
        await read2();
        if (remainder.length !== 0) {
          idle = 0;
          return;
        }
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
      await read2();
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
    const path = await claudeFile2(options.root, options.id);
    if (path !== void 0) offset = (await stat3(path)).size;
    const env = environment();
    const omitted = [...OFF_PLAN2, ...Object.keys(planOnly2()).filter((key) => key.startsWith("GECKIT_"))];
    const config = env.CLAUDE_CONFIG_DIR ?? join4(homedir5(), ".claude");
    const launch = ["exec", "env", ...omitted.flatMap((key) => ["-u", key]), `PATH=${env.PATH ?? ""}`, ...env.CLAUDE_CONFIG_DIR === void 0 ? [] : [`CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`], claudeCommand2(env), ...terminalArgs(options, config)].map(quote).join(" ");
    await tmux(["new-session", "-d", "-s", name, "-x", "140", "-y", "50", "-c", options.root, launch]);
    if (ended) {
      await tmux(["kill-session", "-t", name]).catch(() => void 0);
      return;
    }
    running = true;
    poll = setInterval(() => {
      void catchUp();
    }, 500);
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
  const keys = async (text2, ready) => {
    for (const character of text2) {
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
    async inject(text2, images = [], before = []) {
      if (ended || !running || !turn || stopping) throw new Error("Claude Code is no longer working. Your message is still queued.");
      if (submitting || answering || pending !== void 0) throw new Error("Answer Claude Code's question before sending this message.");
      submitting = true;
      let typed2 = false;
      const ready = async () => {
        if (ended || stopping || !turn || !await alive()) throw new Error("Claude Code is no longer working. Your message is still queued.");
        const screen = terminalScreen(await tmux(["capture-pane", "-p", "-t", name]));
        if (screen.kind !== "working") throw new Error(screen.kind === "question" ? "Answer Claude Code's question before sending this message." : "Claude Code is not ready to receive this message. Your message is still queued.");
      };
      try {
        await ready();
        const paths = await imagesIn(images);
        await ready();
        const prompt = [...before, text2, ...paths.map((path) => `Image attachment: ${path}`)].join("\n\n");
        typed2 = true;
        await keys(prompt, ready);
        idle = 0;
      } catch (error) {
        if (typed2 && !ended) {
          const screen = terminalScreen(await tmux(["capture-pane", "-p", "-t", name]).catch(() => ""));
          if (screen.kind === "working" || screen.kind === "idle") await tmux(["send-keys", "-t", name, "C-u"]).catch(() => void 0);
        }
        throw error;
      } finally {
        submitting = false;
      }
    },
    send(text2, images = [], before = []) {
      if (ended) return;
      submitting = true;
      turn = true;
      emit([], [], [{ kind: "begun" }]);
      stopping = false;
      activity = false;
      failure = "";
      idle = 0;
      const sending = imagesIn(images).then(async (paths) => {
        const prompt = [...before, text2, ...paths.map((path) => `Image attachment: ${path}`)].join("\n\n");
        if (!running && starting === void 0) starting = start();
        await starting;
        await waitForPrompt();
        emit([], [], [{ kind: "doing", what: "sending to Claude Code" }]);
        await keys(prompt);
        emit([], [], [{ kind: "doing", what: "waiting for Claude Code" }]);
      });
      void sending.finally(() => {
        submitting = false;
      }).catch((error) => {
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
        let typed2;
        if (index === -1) {
          index = screen.options.findIndex((option) => /^(?:Type something|Other\b)/i.test(option.label));
          typed2 = answer;
        }
        if (index === -1) {
          pending = void 0;
          ask(screen);
          return;
        }
        const distance = index - screen.focus;
        if (distance !== 0) await tmux(["send-keys", "-t", name, ...Array.from({ length: Math.abs(distance) }, () => distance < 0 ? "Up" : "Down")]);
        await tmux(["send-keys", "-t", name, "Enter"]);
        if (typed2 !== void 0) await keys(string7(typed2));
        pending = void 0;
        idle = 0;
      })().catch((error) => {
        emit([], [], [{ kind: "ended", how: "failed", text: error.message }]);
        void close();
      }).finally(() => {
        answering = false;
      });
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
var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
var HOUR = 36e5;
var PERIODS = { fiveHour: 5 * HOUR, sevenDay: 7 * 24 * HOUR };
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
function usageScreen(text2, now = Date.now()) {
  const lines = plain2(text2).split("\n").map((line) => line.trim());
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
function planNow(plan2, now) {
  const shown2 = {};
  for (const [key, window] of Object.entries(plan2)) {
    let resetsAt = window.resetsAt;
    while (resetsAt <= now) resetsAt += PERIODS[key];
    shown2[key] = resetsAt === window.resetsAt ? window : { part: 0, resetsAt };
  }
  return shown2;
}
function usageReader(runtime, { name = "geckit-claude-usage", folder = join4(tmpdir(), "geckit-claude-usage"), every = () => (15 + Math.random() * 15) * 6e4 } = {}) {
  const { claudeCommand: claudeCommand2, OFF_PLAN: OFF_PLAN2, planOnly: planOnly2 } = runtime;
  const environment = () => Object.fromEntries(Object.entries(planOnly2()).filter(([key]) => !key.startsWith("GECKIT_")));
  const tmux = (args) => new Promise((resolve2, reject) => {
    execFile2("tmux", [...args], { env: environment(), windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(stderr.trim() || error.message));
      else resolve2(stdout.trim());
    });
  });
  const screen = () => tmux(["capture-pane", "-p", "-J", "-t", name]);
  let plan2;
  let next = 0;
  let reading;
  const read2 = async () => {
    if (await tmux(["has-session", "-t", name]).then(() => true, () => false)) await tmux(["send-keys", "-t", name, "Escape"]);
    else {
      await mkdir(folder, { recursive: true });
      const env = environment();
      const omitted = [...OFF_PLAN2, ...Object.keys(planOnly2()).filter((key) => key.startsWith("GECKIT_"))];
      const launch = ["exec", "env", ...omitted.flatMap((key) => ["-u", key]), `PATH=${env.PATH ?? ""}`, ...env.CLAUDE_CONFIG_DIR === void 0 ? [] : [`CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`], claudeCommand2(env)].map(quote).join(" ");
      await tmux(["new-session", "-d", "-s", name, "-x", "140", "-y", "150", "-c", folder, launch]);
    }
    for (let attempt = 0; ; attempt += 1) {
      if (attempt === 300) throw new Error("Claude Code did not become ready for /usage.");
      const shown2 = terminalScreen(await screen());
      if (shown2.trust && shown2.trustFocus === 0) await tmux(["send-keys", "-t", name, "Down"]);
      else if (shown2.trust && shown2.trustFocus === 1) await tmux(["send-keys", "-t", name, "Enter"]);
      else if (shown2.kind === "idle") break;
      await delay(shown2.trust ? 700 : 100);
    }
    await tmux(["send-keys", "-l", "-t", name, "/usage"]);
    await delay(500);
    await tmux(["send-keys", "-t", name, "Enter"]);
    try {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        await delay(100);
        if (!/% used/.test(await screen())) continue;
        await delay(1e3);
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
        reading ??= read2().then((found) => {
          if (found !== void 0) plan2 = found;
        }, () => void 0).finally(() => {
          next = Date.now() + every();
          reading = void 0;
        });
        await reading;
      }
      return plan2 === void 0 ? void 0 : planNow(plan2, Date.now());
    },
    heard(said) {
      plan2 = { ...plan2, ...said };
    },
    dispose: () => tmux(["kill-session", "-t", name]).catch(() => void 0)
  };
}
function create() {
  const usage = usageReader(claude_runtime_exports);
  let known = [];
  return {
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
    available: true,
    subscriptionOnly: true,
    images: true,
    remoteControl: false,
    nativeGoals: false,
    idleMs: 36e5,
    waitForExit: true,
    instructions: "own",
    setInstructions: async () => {
    },
    account: () => claudeAccount(),
    program: () => claudeProgram(),
    models: async () => {
      const found = await claudeModels();
      if (found !== void 0) known = found;
      return found;
    },
    limits: async (models) => {
      const plan2 = await usage.plan();
      return { windows: new Map(models.map((model) => [model, known.find((one) => one.value === model || one.id === model)?.contextWindow])), ...plan2 === void 0 ? {} : { plan: plan2 } };
    },
    list: async (roots) => {
      const rows = [];
      for (const root of roots) {
        for (const { below, ...row } of await listClaude(root).catch(() => [])) rows.push(below === void 0 ? { ...row, root } : { ...row, root: below, project: root });
      }
      return rows;
    },
    search: (roots, asked) => searchClaude(roots, asked),
    hidden: (from, to, include) => everyClaude(from, to, include),
    create: async () => randomUUID(),
    fork: async (root, id, at) => {
      const point = await forkPoint(root, id, at).catch(() => void 0);
      const items = (await readClaudeSession(root, id).catch(() => void 0))?.items ?? [];
      const upTo = items.findLastIndex((item) => "at" in item && item.at !== void 0 && item.at <= at);
      return { id: randomUUID(), fork: { from: id, ...point === void 0 ? {} : { at: point } }, begun: false, items: items.slice(0, upTo + 1) };
    },
    has: async (root, id) => await claudeFile(root, id) !== void 0,
    read: (root, id) => readClaudeSession(root, id),
    links: (root, id) => readLinks(root, id),
    goal: (root, id) => readGoal(root, id),
    setGoal: async () => void 0,
    clearGoal: async () => void 0,
    rename: async () => {
    },
    remote: async () => {
      throw new Error("Claude Code (tmux) does not support remote control.");
    },
    mcp: (root, change) => readMcp(root, change),
    browsers: async (root, pick) => root === void 0 ? void 0 : readBrowsers(root, pick),
    correct: async () => ({ ok: false, error: "Claude Code correction is not available." }),
    delete: (root, id) => deleteClaude(root, id),
    dispose: () => {
      void usage.dispose();
    },
    hold: (options, hear, left) => holdTmux(claude_runtime_exports, options, (heard) => {
      for (const signal of heard.signals) if (signal.kind === "plan") usage.heard(signal.plan);
      hear(heard);
    }, left)
  };
}
export {
  create,
  holdTmux,
  planNow,
  terminalScreen,
  usageReader,
  usageScreen
};
