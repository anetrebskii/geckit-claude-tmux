---
type: spec
status: implemented
owner: Alex
created: 2026-10-09
---

# UX: Inject queued guidance into running Claude

GeckIt's queued rows offer "Send now" when this live driver exposes optional `inject(text, images?, before?)`. The host retains its queue entry until terminal submission succeeds. The driver accepts only a running turn with a recognized working input, no native question, no concurrent typing/answering and no stop in progress.

The driver types at the existing measured pace and presses Enter. It does not wait for idle, interrupt the work, alter permission mode or synthesize a second turn-start/completion event. Claude consumes the guidance at its next safe opportunity after current tool calls. Current transcript and work state remain authoritative.

State transitions:

| From | Event | To | Visible result |
| --- | --- | --- | --- |
| Working | Alex presses "Send now" | Submitting | Host displays "Sending..." |
| Submitting | Terminal accepts Enter, automatically | Working | Host removes selected queue entry and adds message to transcript |
| Working/Submitting | Terminal shows question or ceases working | Working/Waiting/Idle | Submission rejects; host retains queued message |
| Working | Native turn ends, automatically | Idle | Existing completion and image cleanup |

No native approval is answered by injection. A screen is checked before each typed character and Enter; if it becomes idle, an unsent input draft is cleared with Ctrl+U. If a question appears while typing, no final Enter is sent. Native question screens remain untouched, so any partial draft may require inspection in the terminal before retrying. This is an inherent race in terminal input; use builtin stream Claude for acknowledged structured delivery.

No new polling, time threshold, theme rules or renderer controls belong to the library. Host queue layout, keyboard, focus and error behavior are shared. Tests use real isolated tmux with fake Claude, proving text/images/before, consumption at a safe boundary, one active lifecycle, no interruption and preserved native approval.
