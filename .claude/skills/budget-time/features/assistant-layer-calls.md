# In-LIMS assistant calls against the hosting estimates

**Not built.** The assistant layer is decided in [Decide the assistant layer](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/43) and does not exist on `main`. Report this feature as skipped until the assistant route and its call log exist. It is mapped now so the proof is ready when they land.

[Research: running an assistant within the demo's hosting, cost and security limits](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/42) assumed an explain-and-find call of 6,000 input and 800 output tokens ($0.020), and a draft of 12,000 and 2,000 ($0.044), on `claude-sonnet-5-5`, about $8.64/month on the demo under a $10 workspace cap. It says these are to be replaced by measured `usage`.

## Sub-features

- `call-usage`: each assistant call's real input, output and cache tokens, from the API response `usage`, as the call log stores them.
- `tier-average`: mean tokens and cost per tier against the estimates above.
- `monthly-projection`: measured cost per call × the demo volumes (300 explain, 60 draft) against the $10 cap.

## How to get to it (user POV)

- An Analyst presses an in-context assistant button (for example on a Deviation or a failing result) in the LIMS web UI; a Customer User uses it on the portal.

## Driving it with tokens.py

- Not drivable yet. When built: drive the button through the UI as a signed-in demo user (not a test-only endpoint), then read the call-log rows it wrote and compare their `usage` with the estimates. `tokens.py` measures Claude Code runs and does not apply; extend this file with the real route, selectors and call-log query at that point.

## Gotchas

- The call log is a regulated record under the compliance review (§6 of the hosting research): read it, never write or delete rows to set up a measurement.
- The demo workspace has a $10 spend cap; a measurement campaign must fit under it or use its own workspace.
