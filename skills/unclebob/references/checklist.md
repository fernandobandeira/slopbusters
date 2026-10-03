# Review Checklist

Use this as a thinking aid, not a form to fill in. Report only what you actually find.

## Repository rules

- [ ] Did you read every `AGENTS.md`, `CLAUDE.md`, or `CONTRIBUTING` file on the path to each changed file, and the lint config? Their rules outrank everything below.
- [ ] Does the diff break one of those rules? That is a must-fix, cited by file and rule, whatever your own taste says.
- [ ] Does the diff contain hunks the change didn't need (reworded comments, reordered lines, renames nobody asked for)? They cost the reviewer time to prove nothing changed.

## Readability and the onion

- [ ] Does each entry point (handler, controller, use case, public method) read like the business rule, in a handful of well-named steps?
- [ ] Does each function stay at one level of abstraction? Look for business steps sitting next to low-level detail (regex, index math, raw SQL, HTTP plumbing, manual loops).
- [ ] Do callers appear above callees, so the file reads top-down? (Where the language allows it.)
- [ ] Are the nuances and edge cases pushed into lower-level functions whose names announce them (`applyLoyaltyDiscountIfEligible`, `retryOnRateLimit`)?
- [ ] Is there over-fragmentation? One-line wrappers whose name repeats the body, or call chains you have to jump through five files to follow.
- [ ] Do names reveal intent? Functions are verbs that say what they do, booleans read as questions (`isExpired`, `hasAccess`), and collections are plural.
- [ ] Are there names that lie, such as a `get` that mutates, a `validate` that also saves, or a `user` that is actually an ID?
- [ ] Does the diff introduce a word the codebase doesn't use for an idea the codebase already names? Search for the concept; point at the existing term and where it lives.
- [ ] Are two adjacent names one word apart with different meanings (`replacedById` next to `replacementId`)? Rename so the call site can't confuse them.
- [ ] Do comments explain *why*, not *what*? A comment explaining what a block does is usually a function name waiting to be extracted.
- [ ] Does every branch, guard, or ordering that exists for a non-obvious reason either carry that reason in a function name or in a one-line *why* comment? If a reviewer would ask "why is this here?", the answer belongs in the code.

## Reusability

- [ ] Did the change reimplement something the codebase already has (date formatting, money math, retries, validation, API clients, test factories)? Name the existing symbol and file.
- [ ] Is logic duplicated across files in the diff?
- [ ] Is the duplication real (same idea, same reason to change) or coincidental (looks alike, will diverge)? Only flag the real kind.
- [ ] Is there premature abstraction: a generic helper, config flag, or base class built for a single use?
- [ ] Is reusable business logic trapped inside a UI component, controller, or framework callback where nothing else can call it?

## Cognitive load

- [ ] Nesting deeper than two levels. Suggest guard clauses, early returns, or extraction.
- [ ] Long functions. Roughly, anything you cannot take in at a glance (about 20–30 lines) deserves a look.
- [ ] More than about three parameters. Suggest a parameter object, or ask whether the function does too much.
- [ ] Boolean flag parameters (`render(true)`). The function does two things; split it.
- [ ] Negated or compound conditions (`if (!(a && !b))`). Name them with a well-named boolean or function.
- [ ] Magic numbers and strings. Name the constant.
- [ ] Clever code: dense one-liners, nested ternaries, chained operations that need a whiteboard.
- [ ] Hidden side effects and temporal coupling (A must be called before B, but nothing enforces it).
- [ ] Inconsistent error handling: mixed exceptions, result objects, and null returns for the same kind of failure.

## Patterns and design

- [ ] Single Responsibility: does a module or class have more than one reason to change?
- [ ] Are business rules independent of frameworks, databases, and I/O, so they are easy to test and reuse?
- [ ] A growing `switch`/`if-else` on a type that would read better as polymorphism or a lookup table.
- [ ] Primitive obsession: passing `string`/`number` around where a small value type would carry meaning and validation.
- [ ] Dependencies injected at the boundaries instead of constructed deep inside business logic.
- [ ] Over-engineering: an interface with one implementation and no test seam, a factory for one class, layers that only forward calls.
- [ ] Does the change follow the codebase's existing patterns? If it introduces a new one, is that justified?

## Tests

- [ ] Is every new behavior covered, including the important edge cases and error paths?
- [ ] Is each test Arrange-Act-Assert, with the phases visually separated (a blank line between them, or comments in larger tests)?
- [ ] Is there exactly one Act per test? Multiple acts usually mean multiple tests.
- [ ] Does the test name describe the behavior and the condition (`returns 404 when the order does not exist`), not the method name (`testGetOrder`)?
- [ ] Is there logic in tests (loops, conditionals, computed expectations)? Tests should be straight-line and obvious.
- [ ] Is the Arrange phase noisy? Suggest builders, factories, or fixtures, and reuse the ones that already exist.
- [ ] Do assertions check observable behavior (return values, state, emitted events) instead of implementation details (private calls, exact mock call counts that don't matter)?
- [ ] Could the assertion pass if the code ignored the input? An expected value equal to what the fixture or stored state already holds proves nothing; use a value the system could not have produced on its own.
- [ ] Does a component, form, or handler that dispatches to several variants have one test per variant it can reach?
- [ ] Is a control case (the path that should *not* fail) its own test with its own name, rather than a line inside the failure test?
- [ ] Are tests independent of each other and of execution order?
