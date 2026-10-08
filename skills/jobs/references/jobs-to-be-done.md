# Jobs to be Done: the first sentence of every issue

From Clayton Christensen, Taddy Hall, Karen Dillon, and David Duncan, *Competing Against Luck* (2016). People don't buy products; they hire them to make progress in a particular circumstance. The job is stable; the solutions people hire for it change. Understand the job and the solution follows. Build the solution first and you spend the review arguing about it without knowing what it is for.

## The job sentence

Every issue opens with one sentence in this shape:

> When **[circumstance]**, **[who]** wants to **[make this progress]**, so that **[outcome]**.

- **Circumstance** is the situation, not the persona. "A customer who has an invoice and no saved bank account on file" is a circumstance. "SMB users" is a demographic, and demographics don't hire anything.
- **Who** is the person making progress, and there is often more than one. A collection feature has the merchant who wants to be paid and the customer who wants to pay without friction. Name both if both matter; the second often supplies the non-goals.
- **Progress** is what is different afterwards, in their words. "Get paid without chasing" is progress. "Receive an ACH credit to a dedicated receiving number" is a solution.
- **Outcome** is why the progress matters, and it usually carries the emotional or social dimension: "so that they stop writing reminder emails", "so that finance stops asking which payment this was".

If you cannot write the sentence, you don't understand the issue yet. Go back to [mom-test.md](mom-test.md).

## Three dimensions

Every job has a functional dimension and usually an emotional and a social one. A spec that names only the functional one tends to ship something technically correct that nobody adopts.

| Dimension | Question | Example |
|---|---|---|
| Functional | What task gets done? | Collect an invoice payment by bank transfer. |
| Emotional | How does the person want to feel? | Confident the money will reconcile itself; not anxious about an unidentified deposit. |
| Social | How do they want to be seen? | Professional to their customer: a clean set of instructions, not a PDF with a routing number circled in pen. |

Put the functional dimension in the job sentence. Put the other two in "Done means" where they can be verified ("the customer receives one set of instructions, never two") or in the FAQ where they explain a decision.

## What the job gives you

- **Done means** is the progress, stated so someone can check it. If a "Done means" bullet doesn't make the progress in the job sentence more true, it belongs in the FAQ or nowhere.
- **Not in scope** follows from the jobs you are not hiring for. If the job is "get paid without chasing", refunds are a different job, and the sentence "Refunds are a separate job; see X" writes itself.
- **Decisions** become arguable. "Instructions belong to the payment, not the invoice, because the job is one collection attempt and a second attempt is a new hire" is a decision a reviewer can engage with. "Instructions are payment-scoped" is a fact they can only accept.

## Signals that you have found a job

- **Workarounds.** People are doing something awkward to make the progress today: a spreadsheet, a reminder email, a manual bank transfer. The workaround is the job's current hire and the best description of the progress.
- **Non-consumption.** People who could make the progress and don't. They are the clearest signal that the current solutions ask too much.
- **Firing.** People stopped using something. What did they hire instead, and what did it do better?

## Signals that you have not

- The sentence names a feature ("wants to use the new funding-instructions endpoint").
- The sentence names a demographic instead of a circumstance.
- The outcome is the same as the progress restated.
- You could swap in a competitor's product and the sentence would be false. Jobs are about the person, not about us.

## In the skill

The job sentence is the first line of the description (Step 3 and Step 4). Non-goals, Done means, and Decisions each check themselves against it. Scenarios in the FAQ are the job sentence acted out by a named person.
