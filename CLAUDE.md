# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Git safety

- Never run `git push --force`, `git push --force-with-lease`, `git reset --hard`, `git clean -fd`, `git rebase`, or any history-rewriting command without asking first and showing exactly what will change.
- If a push is rejected, STOP and show the divergence with `git log --oneline origin/main..main` and `git log --oneline main..origin/main`. Do not propose force-push as the default. Propose rebase or merge first.
- Never garbage-collect, prune, or rewrite history without explicit approval.
