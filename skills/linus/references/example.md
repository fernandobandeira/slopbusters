# Before and after: one big PR becomes a stack

A real stack, moved to a different domain. A calendar app gives each event an optional video meeting room from an external video provider, so attendees get a join link in place of a room address.

## Before: one PR

**81 files, +3,979 / −163.** Title: `CAL-123 Add video meeting rooms to events`.

The description opened with "Implements CAL-123" and then ran for several screens:

```markdown
## Summary
- Gives each video event one durable room identity on the organizer's connected provider account...
- Uses a scoped job for prompt work and the lifecycle sweep for recovery after enqueue/provider failures. Exact replay retains the event, provider identity, and current readiness state.
- Keeps `video` non-null:
  - `pending`: provisioning unfinished; `joinUrl: null`, null `createdAt`...
...
## CI repair
The previous pushed revision failed before the tests ran: the type checker exhausted Node's 2 GB heap...
## Verification
- Provider sandbox E2E passed at 14:03 UTC, using local workspace `ws_01M3...` ...
- Correction to earlier smoke reporting: the supposed "sandbox room limit" was a smoke-script assertion...
- Full-branch review by <model>: no blockers.
```

What's wrong with it:

- Five ideas in one diff: a provider adapter, a data model change, a public API change, a background lifecycle, and cleanup crons. A reviewer can't hold them at once, so they skim.
- No entry point. Nothing says which of the 81 files hold the behavior and which are one-line guards.
- No questions. The reviewer has to work out where the risk is on their own.
- Process narration (CI repair, corrections, sandbox IDs, model reviews) is mixed in with what the change does.
- Dense, hedged wording ("durable room identity", "is not a claim that the provider has already deleted the room").

## After: five layers

| # | Layer | Files | Lines | One line |
|---|---|---|---|---|
| 1 | Provider | 9 | +235 / −3 | Create and delete meeting rooms at the video provider. Nothing calls them yet. |
| 2 | Model | 35 | +689 / −108 | An event's location becomes in-person or video; every room-only path guards against video. |
| 3 | API contract | 7 | +385 / −14 | The event `location` response gains a `video` variant. |
| 4 | Room lifecycle | 24 | +1,328 / −10 | Create video events behind a flag, open the room once the provider is connected, delete it on cancel. |
| 5 | Cleanup and recovery | 19 | +489 / −11 | Delete rooms after their events end and recover lost creations and deletions. |

Total +3,126: about 850 lines fewer than the original, because code that only supported the tangled whole didn't survive the split.

Things to notice:

- **Layers 1 and 3 land before their callers.** Each merges without changing behavior, so each review asks one question: is this correct? Each has its own tests and names the layer that calls it (`Nothing calls them yet; layer 4 does`).
- **Layer 2 changes behavior on purpose, and narrowly.** Its guards run as soon as it lands, and its description names the one thing that must not change.
- **Layer 2 is 35 files but reviews fast**, because its description says most of them are one-line guards and names the three files to read.
- **Layer 3 is isolated** because the public contract has the widest audience: integrators, docs, and product all care about it, and none of them need the rest.
- **Layer 4 is the biggest** and points at an integration test that reads as a spec of the room lifecycle.
- **Docs land in layers 4 and 5**, with the behavior they describe.
- **The original PR's review threads** are mapped to the layers that fix them, in layer 4's "Earlier review threads" paragraph.

## A full layer description

Title: `CAL-123 [2/5] Model video locations and keep room-only paths in-person`

```markdown
Layer 2 of 5. An event's location is a physical room today, and room booking, capacity checks, and invite rendering all assume one. Video meetings need a location with no room. `Location` becomes `InPersonLocation | VideoLocation`, and every flow that only makes sense for a room either narrows to in-person or rejects video. No route can create a video event yet, so in-person behavior should be unchanged. That is the main question for this PR.

- **Schema.** `LocationKind` gains `video`, `CanceledBy` gains `system`, `Event.roomId` becomes nullable, and a new `EventVideoRoom` table is keyed by the event. One migration; every statement is instant.
- **Domain types.** A new `MeetingLocationKind` covers in-person and video, because the database enum is shared by event, resource, and booking columns.
- **Room-only paths.** `assertInPerson` guards room booking, the capacity check, the room-release webhook, and the invite address block. Recurring-series edits reject video.
- **Contract.** The shared `canceledBy` enum gains `system`. It lands here because the database enum and the API vocabulary must not diverge. Only layer 4 produces it.

**Where to look.** Start with `events.types.ts`, then the migration, then `event.repository.conversion.ts`. Most other files are one-line `assertInPerson` guards or test type updates.

**Review questions**
- Is there a room-only path that should guard against video and does not?
- Does splitting the shared enum into `LocationKind` and `MeetingLocationKind` read clearly?
- Is the migration safe to run against old application instances?

**Verified:** lint, build, test typecheck, the full unit suite, and the event and booking integration tests.

### Stack: video meeting rooms ([CAL-123](https://example.com/CAL-123))

Review bottom-up. Each layer builds, lints, and tests on its own.

1. **Provider:** create and delete meeting rooms at the video provider.
2. 👉 **Model (this PR):** an event's location becomes in-person or video, with schema, migration, and room-only guards.
3. **API contract:** the event `location` response gains a `video` variant.
4. **Room lifecycle:** create video events behind the flag, open the room once connected, delete it on cancel.
5. **Cleanup and recovery:** delete rooms after events end, recovery cron, and their docs.
```
