# Claude Code tmux plugin for GeckIt

This plugin starts or resumes ordinary interactive Claude Code in tmux. Prompts go through terminal input. Replies and tool progress come from Claude's JSONL session transcript; terminal output is inspected only for working, idle and native approval/question states.

The plugin adds no HTTP hooks or GeckIt system instructions. It excludes the global `GECKIT.md` import for this process and does not install a GeckIt guide. User hooks, project instructions, authentication and native permission checks remain active. Existing instructions or resumed conversation history can still mention GeckIt; this is not a guarantee that Claude cannot infer automation.

Install under Settings > Libraries using `https://github.com/anetrebskii/geckit-claude-tmux`, then enable its assistant entry. Requires `claude` and a local macOS or Linux project. Windows is not supported.

## Finding tmux

The plugin uses the first `tmux` that runs from the PATH GeckIt gives it, then from `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`, `/usr/bin`, Linuxbrew, nix and `~/.local/bin`, on its default server, so `tmux attach` reaches its sessions. Without one, it downloads its own copy for macOS (arm64, x86_64) or Linux (x86_64, arm64) from this repository's releases, checks it against the sha256 in `tmux-binaries.json`, keeps it in `~/Library/Caches/geckit-claude-tmux` or `~/.cache/geckit-claude-tmux`, and runs it on a server of its own, `-L geckit`, so a different tmux version already running is never touched. Attach to those sessions with that copy: `<copy> -L geckit attach`. If neither works, the conversation says how to install tmux.

The copies are built by `scripts/build-tmux.sh`: tmux, libevent and on macOS utf8proc linked in, on Linux fully static against musl. Run the `tmux binaries` workflow by hand to publish a release and commit its hashes to `tmux-binaries.json`.

## Sending and reading

Claude Code starts in its interactive terminal. The plugin types prompts of up to 80 Unicode characters through tmux with a random 15-45 ms delay after each character. For longer input, it types the first 12 characters, then pastes the remainder through a private tmux buffer and presses Enter. This preserves multiline text without changing the system clipboard. GeckIt shows "Working - sending to Claude Code" while the text is delivered, then "Working - waiting for Claude Code" after submission. Typed line breaks use Claude Code's backslash-plus-Enter; pasted line breaks stay within one prompt. Images are saved as temporary private files and their paths are included in the prompt.

Every 500 ms, the driver reads only appended transcript bytes. Incomplete JSONL lines remain buffered, including partial UTF-8 characters. Reply text is never reconstructed from terminal output. Saved message blocks arrive after Claude writes them; token-level hook streaming is removed.

Background commands, helpers and forked background skills appear in GeckIt's existing Background list. Forked skills are listed under Helpers using their skill name. The driver reads their IDs, descriptions, commands and output paths from saved tool results. Completion comes from task notices or the final exit marker in a command's output file. Empty or missing output stays running. Polling continues after the reply ends; unchanged tasks produce no updates. This adds no prompts, hooks, `/tasks` commands or model requests. Resuming with a new Claude process restores finished tasks and marks unresolved tasks from the previous process stopped. Native task controls remain available in Claude's terminal.

Queued messages in GeckIt can use **Send now** while this driver works. The optional `Driver.inject` method delivers the selected text and attachment paths with the same typing/paste rule into Claude's current input and presses Enter without waiting for an idle prompt. Claude processes that input after its current tool calls. This does not send Ctrl+C, Escape or Claude's interrupting Send now shortcut. Native questions and unknown terminal states reject injection; GeckIt retains the queued message. Submission confirms terminal delivery, not model application. Images stay available until the turn ends.

Working indicators keep the turn open. A recognized idle input prompt must appear on two consecutive polls after observed activity before GeckIt marks the turn finished. File silence and `end_turn` alone do not mean completion. Unknown terminal layouts remain working. Completion means the turn ended, not that the requested task succeeded.

Native numbered approvals and questions appear as existing GeckIt question cards with Claude's exact choices. Answering navigates the current menu and presses Enter; it rechecks the menu to reject stale answers. Unsupported dialogs must be handled in Claude's terminal. Stop sends Ctrl+C and waits for the idle prompt. The process remains open for follow-ups and shuts down after one hour idle following a finished turn. A new message resets the timer; working turns, pending approvals and tracked background tasks prevent shutdown.

## Own code

The plugin uses nothing of GeckIt's builtin Claude provider. Account, models, history, search, MCP and browser lists come from `src/claude-runtime.mjs`, a copy of GeckIt's Claude code (see `UPSTREAM.md`). `src/provider.mjs` is the adapter; `index.mjs` is the built entry GeckIt installs, rebuilt with `npm ci && npm run build` and committed.

## Plan limits

Plan limits come only through tmux. The plugin keeps one tmux session, `geckit-claude-usage`, running interactive Claude Code in a folder of its own under the system temp folder, confirms the folder's trust prompt once, types `/usage`, reads the `Current session` and `Current week (all models)` rows with their reset times, and presses Esc. It checks once initially, then only after a new message has been successfully sent since the previous check began and the randomized 15-30 minute cooldown has elapsed. Send now deliveries count too; failed sends do not. Without new messages it keeps answering from memory. A window whose remembered reset time has passed is shown as empty, with the next reset one period later, without asking. Windows that `rate_limit_event` lines in a conversation's transcript report are remembered too. Context sizes come from the model list already read. The session is closed when the provider is disposed.

## Logs

An updated GeckIt host passes `context.log` to this library. Its file is `<GeckIt userData>/provider-logs/plugin-claude-tmux.jsonl`, with one `.jsonl.1` backup (2 MiB each). On macOS the installed app uses `~/Library/Application Support/geckit/`; development uses `geckit-local/`. Older hosts without logging continue working.

Follow the file with `tail -F`. Count `usage.command.sent` to audit actual `/usage` submissions, rather than `limits.host.requested` (app polling). `usage.check.started/completed/failed/skipped` records check IDs, messages since the last check, outcomes and next allowed check times. Skip reasons distinguish `no-new-messages`, `cooldown` and `in-flight`. `message.sent` records accepted ordinary/Send now delivery without its text. Session lifecycle and turn outcomes omit prompts, replies and tool arguments. The host adds timestamps, plugin identity and load correlation. The first check initializes limits; later checks require a successful send and the cooldown.

## Verification

Run `npm test` (`node --test test/tmux.test.mjs`). The tests use a fake Claude program inside real tmux; no model account is needed. On a machine with active tmux sessions, set `TMUX_TMPDIR` to a private directory to isolate the test server.

Behavior and verification details: [passive terminal UX](doc/ux/passive-terminal.md).
