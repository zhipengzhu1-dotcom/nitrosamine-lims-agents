# emil

Ten of Emil Kowalski's skills, vendored unedited as the `emil` plugin ([#52](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/52)). Claude Code loads this folder from the repo as `emil@skills-dir`, so each skill is `/emil:<name>`.

- Upstream: https://github.com/emilkowalski/skills
- Commit: `d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128` (2026-09-24), copied on 2026-10-01
- Skills: `emil-design-eng`, `animate`, `review-animations`, `improve-animations`, `find-animation-opportunities`, `mobile-native`, `pick-ui-library`, `prototype`, `apple-design`, `animation-vocabulary`
- Left out: `animate-expo`, `write-swift`, `ask-sonner`
- Licence: upstream's MIT `LICENSE`, copied beside this file

`skills/` and `LICENSE` are byte-identical to upstream. Never edit them. Update by a pull request that copies the folders again at a new commit and changes the commit above and the `version` in `.claude-plugin/plugin.json`.

Prove the copies still match. Run this from the repo root. It prints nothing and exits 0 when they match.

```sh
d=$(mktemp -d) && git clone -q https://github.com/emilkowalski/skills "$d" && git -C "$d" checkout -q d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128 && diff -r -x animate-expo -x write-swift -x ask-sonner "$d/skills" .claude/skills/emil/skills && diff "$d/LICENSE" .claude/skills/emil/LICENSE
```
