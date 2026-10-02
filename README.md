# Claude Code tmux plugin for GeckIt

This plugin starts or resumes a Claude Code chat in tmux. GeckIt sends prompts through tmux and reads structured output from Claude Code hooks and its session transcript. GeckIt closes an idle tmux session to free memory; Claude Code keeps the conversation so it can resume later.

Install it in GeckIt under Settings > Assistants > Add provider from GitHub, using `https://github.com/anetrebskii/geckit-claude-tmux`. Then choose tmux under the message field. The plugin needs `claude` and `tmux` on the computer. It works with local projects on macOS and Linux.

`geckit-plugin.json` describes the provider. `index.mjs` exports `create(host)`, which returns the full GeckIt `LlmProvider` interface. This plugin uses GeckIt's Claude provider for account, models, limits, saved conversations, search, and browser access, and replaces the live conversation driver with tmux. The driver sends prompts to the existing Claude Code conversation and emits transcript items and events through the same callback as other providers.

Run the integration test with `node --test test/tmux.test.mjs`.
