# The rules, their sources, and how they map to a tracker

The persona is Steve Jobs; his principles set what the document is for and what it refuses to carry. The mechanics of a spec come from Joel Spolsky's "Painless Functional Specifications" parts 1 through 4 (October 2000) and "Painless Bug Tracking" (November 2000), both on joelonsoftware.com. Where this skill extends them, the extension is marked: neither wrote for Linear, Jira, and GitHub read by people and agents.

## From Steve Jobs

| Principle | Where he said it | In a tracker |
|---|---|---|
| Start with the customer and work backwards | WWDC, 1997: "You've got to start with the customer experience and work backwards to the technology." | The job sentence comes first. A ticket that opens with the solution gets sent back. |
| Focus means saying no | WWDC, 1997, and his 1997 cut of Apple's line to four products. | "Not in scope" is written for the reader who would assume otherwise, and it is never empty on a feature. |
| Simple is harder than complex | BusinessWeek, 1998: "You have to work hard to get your thinking clean to make it simple." | The visible layer fits one screen. A bullet carrying field names is a collapse that hasn't been filed yet. |
| Design is how it works | The New York Times, 2003. | "Done means" describes behavior someone can observe, not the shape of the code. |
| Real artists ship | The Macintosh team, 1983. | Open questions name who answers them, so the ticket can move. A spec that never reaches "ready" is a hobby. |
| People don't know what they want until you show them | BusinessWeek, 1998. | This is the Mom Test, not an exception to it: hypotheticals are worthless, past behavior is data. Gather what people did; decide what to build yourself. |

## From Spolsky's "Painless Functional Specifications"


| Rule | Spolsky's reasoning | In a tracker |
|---|---|---|
| Write the spec before the code | Designing in prose takes minutes to revise; designing in code takes weeks, and the author gets attached to the code. | The issue is written before implementation starts, and the implementer reads it rather than the Slack thread. |
| One author owns it | "Your specs should be owned and written by one person." A committee spec has no one who knows what it says. | One owner on the issue, named. Others comment; the owner folds. |
| Scenarios with named fictional users | Readers understand a specific person doing a specific thing far better than "the user". | A collapse "What does this look like for a customer?" with two or three named people and what they do, step by step. |
| Non-goals | Explicitly cull what you are not building, so nobody argues about it later. | The "Not in scope" section, visible, written for the reader who would assume otherwise. |
| An overview, then details | The overview is the table of contents; the details decide every screen, field, and error. | The visible layer is the overview. The collapses are the details. |
| Open issues | Flag what is unresolved so the team settles it before coding, not at the end. | "Open questions", always visible, each naming who can answer it. |
| Side notes per audience | Information for testers, marketing, or writers is marked so other readers skip it. | A collapse per audience: "For implementers", "For support", "For partners". |
| The spec is a living document | "The spec always reflects our best collective understanding." He rejects the waterfall spec thrown over a wall. | Fold facts into the sections they belong to. One collapse, "How did we get here?", holds dated history. |
| Specs must be fun to read | A document nobody enjoys is a document nobody reads, and an unread spec is worse than none. | Plain words, a joke where it fits, no filler. |
| Use the simplest language you can | "It has to be understandable, which means written so the human brain can compile it." | The codebase's own terms, active voice, short sentences. |
| Review and reread | Rewrite every sentence you stumble on. | Step 7's checklist, read as someone who wasn't there. |
| Avoid templates | "Have you ever read two good essays that could fit into a template?" | The visible layer has a fixed shape because it is read the same way every time; the collapses are free-form. That is the compromise, and it is marked as ours. |

## From Spolsky's "Painless Bug Tracking"

| Rule | Spolsky's reasoning | In a tracker |
|---|---|---|
| Steps to reproduce, expected, observed | "Every good bug report needs exactly three things." Without the steps, "I probably will have no idea what you are talking about." | The fixed middle of a bug report. Numbered steps, then expected, then observed with evidence. |
| One owner at a time | A bug assigned to two people is assigned to nobody. | One assignee. Reassign explicitly. |
| The reporter closes it | The fixer resolves; the person who saw it confirms it is gone. | Resolved by the implementer, closed by the reporter or tester. |
| Resist new fields | "Every month or so, somebody will come up with a great idea for a new field." Each one makes filing harder, until people stop filing. | Use the tracker's existing fields and labels. Create a label only when asked, and only after checking none covers it. |
| Accept bugs only through the database | If bugs arrive by hallway, the database is incomplete and nobody trusts it. | A problem found in Slack becomes an issue, with the thread linked. |

## Extensions this skill adds, marked as ours

- **Two layers with collapsible sections.** Spolsky printed the whole spec. We have readers with one minute and readers with an afternoon, plus agents that read everything. The visible layer and the FAQ collapses are our answer. The press-release-and-FAQ framing comes from Working Backwards; see [working-backwards.md](working-backwards.md).
- **The job sentence first.** Spolsky opened with an overview. We open with the job the reader is hiring the change for, from Jobs to be Done; see [jobs-to-be-done.md](jobs-to-be-done.md).
- **Gathering rules.** Spolsky assumed the author already knew what to build. We often don't, and the requester's first sentence is a proposed solution. The Mom Test owns the interview; see [mom-test.md](mom-test.md).
- **Agents as readers.** A collapsed section is still binding. Nobody in 2000 had to say so.

## Quotations you may use

These are verbatim and may be quoted. Paraphrase everything else.

From Steve Jobs:

- "You've got to start with the customer experience and work backwards to the technology."
- "Deciding what not to do is as important as deciding what to do."
- "Simple can be harder than complex: You have to work hard to get your thinking clean to make it simple."
- "Design is not just what it looks like and feels like. Design is how it works."
- "Real artists ship."
- "People think focus means saying yes to the thing you've got to focus on. But that's not what it means at all. It means saying no to the hundred other good ideas that there are."

From Joel Spolsky:

- "Failing to write a spec is the single biggest unnecessary risk you take in a software project."
- "Your specs should be owned and written by one person."
- "Don't tell me you weren't born funny, I don't buy it."
- "Use the simplest language you can."
- "Every good bug report needs exactly three things."
- "If you don't tell me how to repro the bug, I probably will have no idea what you are talking about."
- "Every month or so, somebody will come up with a great idea for a new field."
- "Writing is a muscle. The more you write, the more you'll be able to write."
