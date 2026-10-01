# Kernel rules, mapped to pull requests

Every rule in this skill comes from the Linux kernel's process documentation. This file lists where each one comes from and how it translates from emailed patch series to GitHub PRs.

Sources:

- **SP**: [Submitting patches](https://docs.kernel.org/process/submitting-patches.html)
- **POST**: [Posting patches](https://docs.kernel.org/process/5.Posting.html)
- **FOLLOW**: [Followthrough](https://docs.kernel.org/process/6.Followthrough.html)
- **TIP**: [The tip tree handbook](https://docs.kernel.org/process/maintainer-tip.html)
- **NETDEV**: [Networking subsystem](https://docs.kernel.org/process/maintainer-netdev.html)
- **TPP**: Andrew Morton, [The perfect patch](https://www.ozlabs.org/~akpm/stuff/tpp.txt)

## Vocabulary

| Kernel | GitHub |
|---|---|
| Patch | One PR (one layer) |
| Patch series `[PATCH 2/5]` | A stack of dependent PRs, `[2/5]` in the title |
| Cover letter `[PATCH 0/5]` | The stack list repeated in every PR |
| Changelog (above `---`) | Whatever survives the merge: the PR title and body, or the commit messages |
| Commentary (below `---`) | PR comments: version notes, "rebased on main", reviewer replies |
| `base-commit:` | The PR's base branch |
| `checkpatch.pl`, build bots | Linters, CI, and automated review, run *before* opening the PR |
| `vN` resend | Pushing a new round to the same PR |

## Splitting

| Rule | Source |
|---|---|
| Separate each logical change into its own patch. A bug fix and a performance improvement are two patches; an API update and a new driver using it are two patches. | SP "Separate your changes" |
| One change across many files is one patch. | SP "Separate your changes" |
| Each patch should be easy to understand, checkable by a reviewer, and justified on its own merits. | SP "Separate your changes" |
| If one patch depends on another, say so in its description. | SP "Separate your changes" |
| The tree must build and run after every patch, because `git bisect` can stop anywhere. | SP, POST, TPP §6c |
| If a description starts getting long, split the patch. | SP "Describe your changes" |
| The series you post is not your working history. Split the final result in ways that make sense. | POST "Patch preparation" |
| Don't mix kinds of change: a security fix, a restructure, and a reformat in one patch means the fix gets missed. | POST "Patch preparation" |
| Don't overdo it: 500 patches against one file made nobody happy. One large patch is fine if it is one logical change. | POST "Patch preparation" |
| Avoid adding infrastructure that stays unused until the last patch turns it on; bisect will blame the last patch. New code should be active right away whenever possible. | POST "Patch preparation" |
| Cleanups, renames, and moves come first in a series; functional changes come later, so reverting one stays simple. | TPP §6d |
| When moving code, don't change it in the same patch. | SP "Style-check your changes" |
| Post no more than about 15 patches at a time; a small series gets reviewed sooner. | SP, NETDEV |

**Where this skill departs from the kernel.** The kernel would rather new code run as soon as it lands. This skill deliberately lands capability (providers, models, contracts) before its caller, because a layer that changes no behavior is the cheapest kind to review and to merge early. Two conditions keep bisect useful: each such layer has tests that exercise it fully, and its description names the layer that calls it.

## Describing

| Rule | Source |
|---|---|
| Describe the problem first and convince the reviewer it's worth reading past the first paragraph. | SP "Describe your changes" |
| Describe the impact on users, even for problems found in code review. | SP "Describe your changes" |
| Put numbers on optimizations, and describe their costs too. | SP "Describe your changes" |
| Then describe the solution in plain English, so the reviewer can check the code does what you meant. | SP "Describe your changes" |
| Write in the imperative mood, as orders to the codebase. No "this patch", no "I changed". | SP, TIP, TPP §4c |
| Structure: context, problem, solution, in separate paragraphs in that order. | TIP "Changelog" |
| Don't impersonate the code ("we modify..."); abstract wording is more precise than a story. | TIP "Changelog" |
| Draw races and ordering problems as a timeline table. | TIP "Changelog" |
| Cite commits by at least 12 characters of SHA plus the subject. | SP |
| `Fixes:` names the commit that introduced the bug. | SP, POST |
| Link background, but make the explanation understandable without the links. Only add a link if it leads to information the description lacks. | SP, POST |
| If the change supports later patches, say so. If internal APIs change, say what other developers must do. | POST "Patch formatting and changelogs" |
| Write for a reader years from now who has forgotten the discussion. | SP "Explanation Body", TPP §4a |
| Trim backtraces to the lines that matter. | SP "Backtraces" |
| Each version is self-contained. Never "this is v3, see v2". | SP, TPP §4d |
| Version notes and other comments for the moment go below `---`, not in the permanent changelog. | SP "Commentary", TPP §4g |
| A cover letter's text gets lost unless it lands in a commit, so put the series context where it survives. | TPP §6b |

## Titles

| Rule | Source |
|---|---|
| Subject format is `area: summary`, summary under about 70–75 characters. | SP "Subject Line" |
| The summary says what the patch changes and why. | SP "Subject Line" |
| Never use the same summary for every patch in a series. It becomes a unique identifier people search for. | SP, TPP §2a |
| Not a file name. | SP, TIP |
| Imperative, starting with a capital letter. | TIP "Patch subject" |
| Things with no lasting value go in brackets, like `PATCH`, `v2`, and `2/5`, because tools strip them. | TPP §2d |

## Before posting

| Rule | Source |
|---|---|
| Test it, run the style checker, and benchmark anything with performance impact before posting. | POST "Before creating patches" |
| Don't post just to get the bots to test it. Test locally first. | NETDEV "patchwork checks" |
| Run AI reviews before posting; a big series that sets off lots of AI feedback gets little attention from maintainers. | NETDEV |
| Base the work on a known point and say what it is. | SP "Providing base tree information" |

## After review

| Rule | Source |
|---|---|
| Answer every review comment. Ignoring reviewers is a good way to be ignored. | SP, FOLLOW |
| A comment that doesn't lead to a code change should lead to a code comment or changelog entry. | SP, FOLLOW (Andrew Morton) |
| Disagree with technical reasons; reconsider if others side with the reviewer. | FOLLOW |
| Remind reviewers of earlier issues and how you handled them; don't make them dig through old threads. | FOLLOW |
| Don't post a new version while discussion of the last one is still going. Wait at least 24 hours between versions. | NETDEV |
| Wait at least a week before pinging. A bare "ping" is rude: say what you think the status is and ask. | SP, NETDEV |
