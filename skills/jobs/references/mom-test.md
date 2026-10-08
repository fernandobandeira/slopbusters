# The Mom Test: how to gather requirements without being lied to

From Rob Fitzpatrick, *The Mom Test* (2013). The title: if you ask your mother whether your idea is good, she will say yes, because she loves you. Everyone else will too, because it is easier than arguing. So ask questions that even your mother couldn't answer with a polite lie: questions about their life, their past, and what they actually did, not about your idea and what they might do.

Requirements gathering has the same failure. A requester says "users need X" and the ticket gets written around X. The Mom Test is how you find out whether anyone needed X, or whether X was the first solution that came to mind for a problem nobody has written down.

## Three rules

1. **Talk about their life, not your idea.** Ask what they do and how it goes wrong. Don't describe the feature and ask if they'd use it.
2. **Ask about specifics in the past, not generics or opinions about the future.** "When did this last happen?" "What did you do?" "How long did it take?" "Who else was involved?" A past event is data. "Would you…" and "do you think…" invite the polite lie.
3. **Talk less, listen more.** The requester's third sentence is usually more useful than their first. Their first is the solution they came in with.

## Bad data, and what to do with it

| You hear | It is | Ask instead |
|---|---|---|
| "This would be great." "Love it." | A compliment. Zero information. | "When did you last need this? What happened?" |
| "Users always…" "Everyone needs…" "We usually…" | Fluff: a generic claim. | "Tell me about the last time." Then "and the time before that?" |
| "I would definitely use it." "We'll switch as soon as…" | A future promise. | "What are you doing about it today?" |
| "You should add a button that…" | An idea: a proposed solution. | "What would that let you do that you can't now?" Dig to the problem, then write the problem down and the idea as the requester's proposal. |

## Applied to a tracker

- **A feature request is a proposed solution.** Record it, but write the issue around the problem underneath it. The request goes in Decisions if it was adopted ("the requester proposed a per-invoice link; we chose a per-payment one because…") or in a collapse labeled "What did the requester originally ask for, and why did we change it?".
- **"Findings" says how you know.** Reproduced by whom, in what environment; seen in which log, linked; or read from the code only, which means unverified. The Mom Test's "specifics in the past" is the same discipline: an observed event, with its evidence.
- **Count the people.** "Three partners asked" is a requirement. "Partners are asking" is fluff until you can name them. If the count is one, say so; a one-customer requirement is fine, and pretending it is universal is how scope grows.
- **Ask what they do today.** The workaround is the best description of the job (see [jobs-to-be-done.md](jobs-to-be-done.md)) and the baseline that "Done means" improves on.
- **Commitment is the signal.** Someone who agreed to test it, gave you their data, or set a date cares. Someone who said "sounds great" and left didn't. Weight the requirements accordingly, and say in the issue which kind of signal each one rests on.

## The questions, in the order to ask them

For a bug:

1. What were you trying to do?
2. What did you do, step by step? What did you see?
3. What did you expect instead?
4. When did it start? Has it happened before? To whom else?
5. What did you do about it?

For a feature or spec:

1. Tell me about the last time this came up.
2. What did you do? How long did it take? Who else was involved?
3. What do you do about it today?
4. What would be different if this existed? (Listen for progress, not features.)
5. Who else has this problem, and can you name them?
6. If we shipped exactly what you described, what would still be annoying?

## In the skill

Step 2 is this file. Every requirement in "Done means" should trace back to a specific past event, a named person, or an observed log, and the FAQ says which. When a requirement traces back only to a sentence that starts with "users want", go back and ask.
