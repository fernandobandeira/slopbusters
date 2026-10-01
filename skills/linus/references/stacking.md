# Stack mechanics

Read this before creating, updating, rebasing, or merging a stack. [splitting.md](splitting.md) decides *what* goes in each layer; this file picks the tool and the commands.

## Pick the tool

1. **The repo has its own stacking skill or docs.** Follow them.
2. **GitHub stacked PRs with `gh stack`.** Use it when `gh extension list` shows `gh stack` and the repo has stacked PRs enabled (`gh api repos/<owner>/<repo>/stacks` returns 200). Read [gh-stack/overview.md](gh-stack/overview.md), GitHub's official skill for the extension, and follow it for every command. If the user has that skill installed, the installed copy is newer; prefer it.
3. **Another stacking tool already in use** (Graphite, git-town, spr, ghstack). Use it; don't add a second one.
4. **Plain git and `gh`.** Always works. See below.

Ask before installing anything.

When following GitHub's skill alongside this one:

- **splitting.md wins on what goes in a layer.** `gh-stack/references/stack-design.md` is about branch naming and staging; its example layers are illustrations. Tests and docs stay in the layer whose code they cover.
- **The repo's branch naming wins**, then GitHub's `<topic>/<concern>`.
- **`submit --auto` titles PRs from commits or branch names.** Afterwards, set every PR's title and description with `gh pr edit <n> --title ... --body-file ...` (SKILL.md, Steps 4–5).
- **Mark PRs ready (`submit --open`) and merge (`gh stack merge`) only when the user asks.**

## Without a stacking tool

Plain branches with `gh pr create --base` work everywhere.

### Create

```bash
git switch -c me/cal-123-provider main
git add <layer files> && git commit
git switch -c me/cal-123-model
git add <layer files> && git commit
git push -u origin me/cal-123-provider me/cal-123-model

gh pr create --draft --base main                --head me/cal-123-provider --title "..." --body-file 1.md
gh pr create --draft --base me/cal-123-provider --head me/cal-123-model    --title "..." --body-file 2.md
```

### Fix a lower layer

Commit the fix on the layer that owns it, then replay everything above it in one rebase from the top branch. `--update-refs` (git 2.38 or later) moves every intermediate branch along:

```bash
git switch me/cal-123-provider && git commit ...
git switch me/cal-123-api                          # the top
git rebase --update-refs me/cal-123-provider
git push --force-with-lease origin me/cal-123-provider me/cal-123-model me/cal-123-api
```

Turn on `git config rerere.enabled true` once per clone, so a conflict resolved once replays through the layers above.

### After a lower PR squash-merges

The merged commits no longer exist on the trunk, so rebase the next layer onto it and skip them:

```bash
git fetch origin
git switch me/cal-123-api                          # the top
git rebase --update-refs --onto origin/main me/cal-123-provider
gh pr edit <model-pr> --base main
git push --force-with-lease origin me/cal-123-model me/cal-123-api
```

GitHub retargets the next PR on its own only when the merged branch is deleted. Check with `gh pr view <n> --json baseRefName` and fix it with `gh pr edit --base`.

### Merge

Bottom-up, one PR at a time, only when the user asks. After each merge, rebase the remaining layers as above before merging the next one.
