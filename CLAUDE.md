# CLAUDE.md

Guidance for Claude Code when working in this repository.

## UI / design system

- Mosaic's UI follows the **Atlassian Design System** language. The full spec,
  token tables, and component patterns are in **`DESIGN_SYSTEM.md`** — read it
  before building or changing any UI.
- **Style from tokens, never literals.** All colours, radii, and shadows come from
  the CSS custom properties defined in `app/globals.css` (consumed as
  `var(--token)` in inline styles). Do not hardcode hex colours, `rgba()`,
  `borderRadius: <number>`, or drop shadows in components. If a value you need
  isn't a token, add it to both the light (`:root`) and dark (`[data-theme="dark"]`)
  blocks, then consume the token.
- The default theme is `palette = 'mosaic'` (base `:root`). `fluent`/`aubergine`
  are selectable alternates — don't edit them when changing the default look.
- **Air-gap font policy:** never add a runtime web-font link (Google Fonts/CDN);
  Mosaic can run air-gapped. Fonts are system stacks; self-host (`@fontsource`) if a
  brand font is ever required.
- Verify both light and dark mode before shipping a UI change.

## Git safety

- Never run `git push --force`, `git push --force-with-lease`, `git reset --hard`, `git clean -fd`, `git rebase`, or any history-rewriting command without asking first and showing exactly what will change.
- If a push is rejected, STOP and show the divergence with `git log --oneline origin/main..main` and `git log --oneline main..origin/main`. Do not propose force-push as the default. Propose rebase or merge first.
- Never garbage-collect, prune, or rewrite history without explicit approval.
