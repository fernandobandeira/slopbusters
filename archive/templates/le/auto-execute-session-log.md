---
title: Auto-Execute Session {date}
type: session
folder: sessions
tags: [auto-execute, sprint-{sprint}]
---

## Session Summary

- **Start:** {timestamp}
- **Lead Engineer:** Leo (auto-execute loop)
- **Sprint:** {sprint-label}
- **Max Tasks:** {max-tasks}
- **Circuit Breaker:** {enabled/disabled}

## Task Execution Log

### Task 1: {task-id}
- **Title:** {task-title}
- **Priority:** P{0/1/2}
- **Status:** {success/fail/with-questions}
- **Time to Complete:** {minutes}

#### Design Review
- **Spec Complete:** YES/NO
- **Architect Review:** {NONE/REQUIRED}
- **Reviewer:** {architect/ux/self}
- **Decision:** {approved/needs-refinement}

#### Implementation

##### Dev Session
- **Start:** {timestamp}
- **End:** {timestamp}
- **Duration:** {minutes}

##### Acceptance Criteria Check
- **All Passed:** YES/NO

| Criterion | Status | Evidence |
|-----------|--------|----------|
| {criterion 1} | PASS/FAIL | {test output/log} |
| {criterion 2} | PASS/FAIL | {test output/log} |
| {criterion 3} | PASS/FAIL | {test output/log} |

##### Test Results
- **Tests Run:** {number}
- **Tests Passed:** {number}
- **Tests Failed:** {number}
- **Coverage:** {percentage}%

##### Code Changes
- **Files Modified:** {count}
- **Files Added:** {count}
- **Files Deleted:** {count}
- **Lines Added:** {number}
- **Lines Deleted:** {number}

##### Dev Result
- **Return Signal:** {SUCCESS/SUCCESS_WITH_QUESTIONS/FAIL}
- **Questions:** {questions if SUCCESS_WITH_QUESTIONS}
- **Blockers:** {blockers if FAIL}

#### Lead Engineer Review
- **Verification:** {verified/not-verified}
- **Decision:** {PASS/FAIL/RETURN}
- **Reason:** {reason for decision}

##### Discovery Tracking
- **TODOs Found:** {number}
- **Tasks Created:** {task-ids}
- **Bugs Created:** {bug-ids}

##### Architect Review (if needed)
- **Reviewer:** @architect
- **Session ID:** {session-id}
- **Findings:**
  - Critical Issues: {list}
  - Major Issues: {list}
  - Acceptable: {list}
- **Recommendations:** {list}

##### Final Decision
- **Action:** {approved/rejected/returned-to-dev}
- **Beads Command:**
  ```bash
  bd {close/update/comment} {task-id} --reason "{reason}"
  ```

### Task 2: {task-id}
- **Title:** {task-title}
- **Priority:** P{0/1/2}
- **Status:** {success/fail/with-questions}
- **Time to Complete:** {minutes}
- **...same structure as above...**

## Session Statistics

### Overall Metrics
- **Tasks Attempted:** {number}
- **Tasks Completed:** {number}
- **Tasks Failed:** {number}
- **Tasks With Questions:** {number}
- **Total Duration:** {minutes}

### Review Breakdown
- **Self-Reviews:** {number} (Lead Engineer acceptance checks)
- **Architect Reviews:** {number}
- **UX Reviews:** {number}
- **Other Specialist Reviews:** {number}

### Discovery Tracking
- **TODOs Discovered:** {number}
- **Tasks Created from TODOs:** {number}
- **Bugs Created:** {number}

### Circuit Breaker Events
- **Triggered:** YES/NO
- **Reason:** {why circuit breaker triggered}
- **Recovery Action:** {recovery action}

## Decision Patterns

### Review Decisions by Pattern

| Pattern | Count | Examples |
|----------|-------|----------|
| Pure implementation (no review) | {number} | Task IDs: {...} |
| Architecture review needed | {number} | Task IDs: {...} |
| UX review needed | {number} | Task IDs: {...} |
| Security review needed | {number} | Task IDs: {...} |
| API review needed | {number} | Task IDs: {...} |
| Database review needed | {number} | Task IDs: {...} |

### Learnings for Future

#### What Worked Well
- {success pattern 1}
- {success pattern 2}
- {success pattern 3}

#### What Didn't Work
- {failure pattern 1}
- {failure pattern 2}
- {failure pattern 3}

#### Improvements for Next Session
- {improvement 1}
- {improvement 2}
- {improvement 3}

## Beads Status at Session End

### Sprint Progress
- **Total Sprint Tasks:** {number}
- **Completed this Session:** {number}
- **Remaining:** {number}

### Next Actions
- **Top Priority Task:** {next-task-id}
- **Blocked Tasks:** {blocked-task-ids}
- **Ready for Auto-Execute:** {number} tasks

## Related Links

- [[Lead Engineer]] - This orchestrator
- [[Dev]] - Implementation subagent
- [[Auto-Dev Loop]] - Pattern this session enhances
- [[Sprint {sprint}]] - Related sprint documentation
