# Runtime provenance

`src/claude-runtime.mjs` is copied from https://github.com/anetrebskii/geckit at commit `09b5b12` plus the plugin independence change in that checkout, on 2026-10-09: account, models, the session file reader and native history, MCP and browser lists. GeckIt maintainers regenerate it with `node client/scripts/export-claude-runtime.mjs` from the GeckIt checkout; it replaces this file. Otherwise edit the copy directly. Nothing fetches upstream at install or runtime.
