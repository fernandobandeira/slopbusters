# Working Backwards: the press release is the first screen, the FAQ is the rest

From Colin Bryar and Bill Carr, *Working Backwards* (2021), describing Amazon's PR/FAQ process. Before building anything, write the one-page press release you would publish at launch, then the FAQ that answers every hard question a customer or an executive would ask. Writing the announcement first forces you to know what the customer gets; the FAQ forces you to know what it costs and where it breaks. The narrative replaces the slide deck because prose can't hide a gap behind a bullet.

## Why it fits a tracker

An issue already has two readers. One wants to know what is happening and whether to care; the other is about to build or review it and wants everything. The press release serves the first. The FAQ serves the second. Collapsible sections let both live in one document without either paying for the other.

## The press release, as the visible layer

Amazon's press release has a heading, a subheading, a summary, the problem, the solution, a leader's quote, how to get started, and a customer quote. A tracker issue is shorter, and the quotes don't survive contact with an engineering team, but the moves are the same:

| Press release | Visible layer |
|---|---|
| Heading: what the customer gets | Title: the outcome and who gets it |
| Summary paragraph | The job sentence, then two or three sentences of context |
| Problem | What exists today and why it isn't enough |
| Solution | What this issue changes |
| How to get started | Done means: what is observably true when it ships |
| What it isn't | Not in scope |

Write it as if the work has shipped. Future tense invites hedging. "Partners create a push-funded payment and receive dedicated instructions" is checkable. "Partners will be able to…" is a promise.

## The FAQ, as the collapses

Amazon splits the FAQ into customer questions and internal questions. The internal ones are the hard ones: what does it cost, what depends on what, what are we deliberately not doing, what breaks. A tracker issue has the same two kinds:

- **Reader questions** are what a product manager, a reviewer, or a partner would ask after the first screen. "What does the customer actually see?" "What happens when a transfer arrives after the payment is complete?" "Why does the instruction belong to the payment and not the invoice?"
- **Implementer questions** are what the person building it asks on day one. "Which statuses exist and what moves between them?" "What does the API return in each state?" "Where in the code does this land, and which docs change?"

Each collapse is one question and its answer. The label is the question. A reader scans the labels the way they would scan an FAQ, opens the one they have, and leaves the rest closed. An agent opens them all.

## Rules carried over

- **Short is a feature.** Amazon capped the press release at a page because a longer one means the author hasn't decided. The visible layer fits one screen for the same reason.
- **Write the hard questions.** An FAQ with only easy questions is marketing. If a question would be awkward in review, that is the one to write down with its answer.
- **The FAQ is where the rationale lives.** A decision in the visible layer gets one clause of why. The paragraph of why, with the alternatives and what they would have cost, is a collapse labeled with the question it answers.
- **Narrative, not fragments.** Inside a collapse, write sentences. A list of nouns under a heading is a slide, and slides hide gaps.

## What not to carry over

- Fictional customer quotes and leadership quotes. They read as filler in an engineering tracker.
- Press-release tone. The visible layer is plain and specific, not promotional. The skill's voice applies: direct, plain, simple everywhere.

## In the skill

Step 4 writes the press release as the visible layer. Step 5 writes the FAQ as collapses labeled with questions. The "How did we get here?" collapse is the FAQ answer to "why did this change?", which is the question every reader of a revised spec has.
