# Splitting a change into a stack

Read this when Step 2 decides the change is a stack, or when the user asks to split a PR or branch. Read [stacking.md](stacking.md) before running the git and GitHub commands.

## 1. Inventory the change

Work from the final result, not the commit history. The series you publish is almost never the order you wrote things in.

- `git diff <base>...<branch> --stat` for the shape, then the whole diff.
- List every change by concern: a new adapter, a schema change, a renamed type, a guard added to 20 call sites, a new route, a cron, docs, tests.
- For each concern, note what it depends on. A route depends on the service, the service on the model, the model on the migration.
- Mark the kind of each change: **preparation** (no behavior change), **new capability** (nothing calls it yet), **behavior change**, or **contract change** (API, events, anything outside callers see).

## 2. Cut the layers

Follow the dependency direction. A typical backend change cuts like this, but let the inventory decide:

1. **Preparation.** Renames, moves, extractions, and cleanups that change no behavior. They go first, so a functional layer can be reverted without dragging them along.
2. **Adapters and providers.** New calls to external systems, with fakes and tests.
3. **Model and schema.** Types, migrations, and guards that keep existing paths behaving the same with the new variant present.
4. **Public contract.** API and event shapes. Isolate it: it has the widest audience and is the hardest to undo.
5. **Behavior.** The flow that uses everything below, behind a flag if it reaches users.
6. **Operations.** Crons, recovery, expiry, backfills: the paths that run when the happy path fails.

Rules:

- **Each layer gets one line.** Write the stack list before moving any code. If a line needs "and also", split it or move the extra part.
- **Don't mix kinds of change.** A security fix, a refactor, and a reformat in one diff means the fix gets missed. Each gets its own layer.
- **Moved code is moved unchanged.** A layer that moves code doesn't edit it. The edit goes in the next layer.
- **Land capability before its caller.** A provider, model, or contract that nothing uses yet merges without changing behavior, so its review asks one question: is it correct? Give it tests that exercise it fully, and name the calling layer in its description ("Nothing calls them yet; layer 4 does"), so bisect can still tell a broken provider from a broken caller.
- **Keep the layer that switches things on focused.** It wires up what is below it and adds the behavior; the capability it uses is already reviewed and tested.
- **Docs land with the behavior they describe**, not in a trailing docs layer.
- **A cross-cutting change lands where it has to, and says why.** If an enum shared by two layers must change in the lower one, put it there and explain it in one sentence.
- **Tests go with their code** and pass in that layer.
- **Splitting is a chance to delete.** Code that only held a tangled whole together often isn't needed once the parts are separate.

## 3. Size the stack

- **Layers.** Aim for 200–700 changed production lines each. A larger layer is fine when it's one concept and has a test that reads as its spec; say so in its description. A smaller one is fine when it's genuinely one idea.
- **Count.** Three to six layers is the sweet spot. Kernel subsystems cap a series at about 15 patches; past six PRs, ship the first few and stack the rest later.
- **Don't overdo it.** A layer that can't be described without naming the layer above it is probably half a layer. Merge it.

## 4. Propose before touching git

Never restructure someone's branch without a yes. Show the plan:

```markdown
Proposed stack (bottom to top), each builds and tests alone:

1. **Provider** (~240 lines): create and delete meeting rooms at the video provider. Called from layer 4; covered by its own tests.
2. **Location model** (~690 lines): an event's location gains a video variant; every room-only path guards against it.
3. **API contract** (~390 lines): the event location response gains a video variant.
4. **Room lifecycle** (~1,330 lines): create video events behind the flag, open the room once connected, delete it on cancel.
5. **Cleanup and recovery** (~490 lines): delete rooms after events end, and a recovery cron.

Shared changes placed lower than you'd expect: `canceledBy` gains `system` in layer 2, because the database enum and the API vocabulary must not diverge.

Open questions: <anything that changes the cut>
```

## 5. Build the layers

Start from the base and build upward. For each layer, bottom to top:

1. Create the layer's branch from the one below (the base, for the first). See [stacking.md](stacking.md) for the commands.
2. Bring over only what belongs to it:
   - Whole files: `git checkout <original-branch> -- <paths>`
   - Part of a file: write the layer's version of the file by hand, or `git diff <base> <original-branch> -- <file> > layer.patch`, cut the patch down to the layer's hunks, and `git apply layer.patch`. Interactive `git add -p` and `git checkout -p` don't work for agents.
   - Code that only the tangled version needed: leave it out.
3. Run the build, lint, and this layer's tests. A layer that only compiles once the next one lands is not a layer yet; move code until it builds.
4. Commit with a changelog-quality message (SKILL.md, Step 6).
5. Repeat for the next layer.

When the top layer is done, check that nothing was lost: `git diff <original-branch> <top-branch>` should be empty, or show only the deletions you made on purpose. Explain any difference to the user.

## 6. Carry over the original PR

- Map each review thread on the original PR to the layer that addresses it, and say so in that layer's description ("**Earlier review threads.** The repository injection fix is here; the retry path is in layer 5.").
- Reply on the original threads with the layer that holds the fix.
- Close the original PR with a comment linking the stack, or repurpose it as one of the layers if its discussion belongs there.
