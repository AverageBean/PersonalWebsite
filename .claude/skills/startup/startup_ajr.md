---
name: ajr-startup
description: Evaluate current project state against requirements, specs, and goals. Identify tasks to work on next based on project progress, gaps, and testing needs. Use at the start of a session to orient and pick up where you left off.
context: fork
---

<args>
$ARGUMENTS
</args>

If special direction was provided in <args/>: keep it in mind as you continue reading, then concentrate your exploration and task selection given that direction.

Please evaluate current project state against project requirements, specs, and goals. Identify all open threads, from brain docs or other durable docs. Be very careful you check our progress of each component fully; just because a subsystem exists doesn't mean it has all required features or functionality!

Use one to four explore subagents to do this efficiently. Sonnet is typically smart enough for this; don't use Opus unless you think you need to investigate something more deeply after initial exploration. You may use git history to inform you about recent work on the project, but do not rely on it fully, or use it in place of proper exploration. If brain docs are in use, you may use them to inform and/or guide your analysis.

At the same time and in the same subagents (no dedicated subagents for this), look for areas where main project docs (README.md, CLAUDE.md, ...) or brain docs differ from current state.

When subagents finish, decide one to four tasks to work on next.

## Recommendations

- If you observe anything still in progress, not yet fully-featured, or not up-to-spec, you should recommend "revision" or "cleanup" tasks rather than tasks for implementing new features. For example, if the last few sessions or commits seemed to have crashed before finishing; if they left "todo" or "finish later" comments; or if they failed to wrap up work.

- If you observe significantly complex code is not tested, you should recommend "testing" tasks; non-integration, integration, and end-to-end tests are a major priority. New functionality should be thoroughly tested, often through **both** non-integration tests and integration tests! Consider whether new functionality should additionally be tested in larger scale end-to-end tests. **You should dedicate serious time** in creating tests, mocks, and validation infrastructure. Don't go overboard; for example, logic 100% covered by integration tests does not need non-integration tests, and utility programs and benchmarks often won't benefit much from extensive testing.

- However: the user may wish to build something this session. Don't push too hard for cleanup or testing tasks, with these exceptions:

  - If there is unfinished or partial work: push for tasks to complete it.
  - If there is non-compliant code conflicting with specs/reqs/brain docs: consider whether we implemented something better and just didn't update the specs/reqs/brain docs, and recommend remedial tasks for the code or docs accordingly.
  - If there are serious testing gaps (for example, the last few sessions or commits worked on new features but didn't write tests): push for these tasks.
  - If you're concerned there are any systemic, architectural, or foundational issues that compromise the project: ALWAYS push for tasks to investigate and/or fix them.

- Unless something is egregiously wrong or concerning, and you think we should stop everything to resolve it, give the user options to work on new functionality or the next layer of the project.
