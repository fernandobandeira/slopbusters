# Before and after: one dense parent issue rewritten

A real parent issue, moved to a different domain. A clinic scheduling app lets a clinic collect an appointment deposit by bank transfer instead of card, so patients without a card on file can still book, and the clinic stops chasing deposits by phone.

## Before

The title: `Deposit collection: payment-owned bank transfer instructions`.

The description opened with an "At a glance" paragraph of about 90 words, then five bullets of 60 to 90 words each, each carrying API field names and status values:

```markdown
## At a glance

Let clinics create a Deposit Request and receive dedicated bank transfer instructions once background issuance activates them. Settled transfers to the request's receiving account add up; the transfer that brings the total to the expected amount completes the request, the account is closed, and the existing booking confirmation takes over. Partial transfers are held, and excess and late credits are kept for operations. The app does not return, reverse, or decline inbound transfers.

* **Owner:** one Deposit Request, not the durable appointment. Reminders reuse its instructions; replacement is a new request.
* **Stable API:** create with `funding.method: transfer`; it stays `transfer`. Transfer funding publishes `status: waiting` in place of `scheduled`. `funding.transfer.instructions` is always present with `status` exactly `pending`, `active` or `expired`, plus `issuedAt` and `expiresAt`. `funding.transfer.payments` is an always-present array of every transfer sent to the account, with status `pending | settled | returned | declined`…
* **Collection:** waiting and partially funded requests reserve nothing. Settled transfers accumulate and are held in the clinic's deposit account; the transfer that brings the settled total to the expected amount completes the request…
* **Lifecycle:** …
* **Boundary:** …

## Delivery
1. [SCH-760 — Issue and close request-owned instructions]
…

>>> API contract, request/response examples and compatibility
(about 1,800 words)
>>>
>>> Collection lifecycle, allocation rules and status table
(about 900 words)
>>>
>>> Scope context, rollout, handoffs and remaining decisions
## Goal
…
**Product decisions — September 30:** this issue records the request-owned contract… Earlier per-appointment ownership rules are superseded…
**Product decision — October 1:** full account details are never stored or returned…
**Product decision — October 2:** the response is regrounded on existing API conventions…
**Product decision — October 2 (partial payments):** funding accumulates…
## Remaining implementation decisions
* Storage/uniqueness, provider idempotency and API replay semantics…
* Atomic precedence at completion when a scheduled card charge competes…
* Which arrival ends unused-expiry eligibility…
>>>
>>> Deferred capabilities, research and reference boundaries
(about 700 words)
>>>
```

What's wrong with it:

- **The first screen is not a one-minute read.** Five bullets of up to 90 words, carrying field names and status vocabularies. A product manager cannot tell what the clinic gets without reading API shapes.
- **There is no job.** It opens with what the system does. Nobody is named making progress.
- **Open questions are buried.** "Remaining implementation decisions" is the single most useful list for a reviewer, and it is inside the third collapse behind four paragraphs of dated history.
- **Collapse labels are topics, not questions.** "Scope context, rollout, handoffs and remaining decisions" answers four questions and gets opened for none.
- **Dated decision paragraphs sit next to the goal.** The reader has to diff four dates in their head to find the current answer.
- **Two canonical documents.** The issue says it governs "until aligned" with a wiki spec. One of them is wrong at any given moment.

## After

Title: `Clinics collect appointment deposits by bank transfer, with instructions that belong to the request`

```markdown
When a patient books without a card on file, the clinic wants the deposit to arrive and match itself to the booking, so that nobody phones the patient for a routing number or hunts for an unlabeled transfer. Today a deposit needs a card, and clinics that take transfers reconcile them by hand. A Deposit Request now gets its own bank transfer instructions; transfers to it add up, and the one that reaches the deposit amount confirms the booking.

## Done means
- A clinic creates a Deposit Request with transfer funding and gets instructions once the account is active
- Transfers to the instructions accumulate; the one that reaches the deposit amount confirms the booking
- Excess and late transfers are recorded and visible to operations; none are sent back
- Unused instructions expire after three months; any received transfer keeps the request open
- Card-funded deposits and every existing booking flow are unchanged

## Not in scope
- Returning, reversing, or declining an inbound transfer. Operations handle excess by hand
- Refunding a confirmed deposit. That is a separate job, SCH-790
- Instructions on an appointment rather than a request. A second collection attempt is a new request

## Decisions
- **Owner:** the Deposit Request owns the instructions, not the appointment, because one collection attempt is one hire and a retry is a new one
- **Partial payments:** transfers accumulate, not one exact credit, because patients split deposits across accounts more often than we expected
- **Account details:** never on the request, list, or events, only from a dedicated endpoint while active, because event payloads are stored by a third party
- **Published status:** `waiting` instead of `scheduled`, because nothing is scheduled

## Open questions
- **Competing collection:** if a card charge and a transfer complete at once, which wins and what happens to the other? Needs payments and product
- **Pending credits:** does a pending transfer stop unused expiry, or only a settled one? Needs product
- **Operations view:** where do excess and late transfers show up, and who follows up? Needs operations

## Delivery
1. SCH-760 Issue and close request-owned instructions
2. SCH-761 Route, record, and publish transfers
3. SCH-762 Accumulate funding and confirm the booking
4. SCH-763 Expose the API, events, and approval flow
5. SCH-764 Release confirmation and handle operational exceptions

+++ What does the clinic and the patient actually see?
Maria runs a two-dentist practice… (three named scenarios: a full transfer, a split transfer, a transfer that arrives after the booking was canceled)
+++

+++ What does the API return in each state?
(create request, response while pending, while active, after a partial transfer, after completion, after unused expiry; one payload per state with a comment line each)
+++

+++ Which statuses exist and what moves between them?
(the status table, and the rule that instructions never return to active)
+++

+++ What happens to a transfer that arrives after completion, or that the bank sends back?
(excess, late credits, bank-initiated returns; what is recorded, where operations see it)
+++

+++ Why does the request own the instructions and not the appointment?
(the rationale paragraph, the per-appointment alternative, and what it would have cost)
+++

+++ What can the bank provider actually do about an inbound transfer?
(provider capabilities for ACH return, wire reversal, RTP; kept as reference, nothing in this delivery uses them)
+++

+++ How did we get here?
- Sept 30: request-owned contract adopted; per-appointment ownership superseded
- Oct 1: account details moved off the request and events to a dedicated endpoint
- Oct 2: response regrounded on existing API conventions; `payments` array replaces per-rail objects
- Oct 2: partial payments accumulate; returning rejected credits removed from scope
+++

+++ For implementers
(code permalinks, docs to update, the enablement gate and what must ship first, verification expectations)
+++
```

What changed:

- **The job is the first sentence.** A reader knows who makes what progress before any field name appears.
- **The visible layer is about 330 words** and carries no API shape. Each bullet is under 25 words.
- **Open questions are visible and name who answers.** They were the third collapse's last section.
- **Every collapse is one question.** A reader scans eight labels and opens the one they have.
- **History is one collapse.** The four dated paragraphs became four lines, and the current answers live in Decisions.
- **Nothing was deleted.** The 4,000 words of contract, lifecycle, and provider reference are all still there, each under the question it answers.
