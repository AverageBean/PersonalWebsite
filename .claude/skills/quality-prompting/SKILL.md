---
name: ajr-quality-prompting
description: Requirements for writing instructions for AI agents. ALWAYS use when writing or editing skills, prompts, specs, and requirements docs.
---

# Quality prompting

These guidelines help improve the conciseness and impact of prompts and instructions written for intelligent AI agents.


## Core principles

### Don't try to sound dramatic or like you're delivering a keynote

Bad:

```
- **Cut the scaffolding:** Before you write a single word, ask yourself: is this serving the reader, or is it serving your comfort? Strip away everything that doesn't earn its place.
- **Make every word fight for its life:** Great writing isn't about adding — it's about removing. The best sentence is the one you realized you didn't need.
```

AI agents love to write like this. The actual advice isn't bad, but it's surrounded by irrelevant fluff and reads like the AI is trying to wow an audience or sound impactful.

- "Cut the scaffolding" means nothing by itself and requires explanation in the next sentence.
- Titling the bullets and bolding them wastes tokens and feels cheap.
- The em dash tries to provide dramatic pause.
- Both bullets say basically the same thing.

Good:

```
- Great writing is mostly removing, and any elements that don't contribute to the reader's understanding should be cut.
```

We dramatically reduced tokens without compromising readability or impact.

Bad: "If an instruction doesn't change behavior, it's decoration."

Good: "Instructions should change behavior."

### Don't negate what nobody assumed

AI agents tend to append em-dash clarifications that deny something the reader was never thinking:

Bad: "Each agent reads the code and returns a plan — no implementation."

"Returns a plan" already means no implementation; the em dash restates the obvious.

Bad: "This is a read-only exploration step — do not modify files."

An intelligent model understands that "read-only" means no files should be modified.

### Use precise vocabulary

For example, prefer:

- "consult" over "make sure to check with"
- "reconcile" over "determine how these agree" or "ensure state is in sync"
- "contextualize" over "put into context"

### Decide when to specify rules, examples, and/or processes

AI models are great at following rules. But in some scenarios, examples are more clear, and processes are more actionable. If providing examples, dedicate significant time devising the minimal set that will convey the necessary breadth to an intelligent model that can read between lines. Consider whether you still need rules after specifying examples and/or processes.

### Decide whether to provide motivations or justifications

Doing so can sometimes help AI agents map instructions to broader problem sets.

### Prefer imperatives to descriptive language

Bad: "Claude should avoid using bullet points excessively."

Good: "Avoid excessive bullet points."

### Write technically, but not too technically

Bad: "Perform a recursive depth-first traversal of the dependency graph to identify circular references."

Good: "Walk the dependency tree and flag any circular references."

### Don't elaborate what highly intelligent AI models already know

*Do* explain how/when/where to apply that knowledge and when it's relevant.

### Give actionable directives and workflows, especially to counteract laziness

Bad: "Understand the ultimate goal."

This fails to tell the model what to do *differently*; intelligent models will already try to understand project goals.

Good: "Before writing any code: stop to think carefully about relevant requirements in every layer, how they support the ultimate project goal, and how they'll impact future layers."

This tells the model when and how to apply that understanding.


## Antipatterns

- Em/en dashes for dramatic pause
- Attempts at poeticism or cleverness ("an essay should be a scalpel, not a speech")
- Starting bullet points with a word or phrase and a colon, instead of focusing on the bullet's content
- Bolding the starts of bullet points
- Conversational hedging ("feel free to", "you might want to consider")
- Overstatement/overdemonstration of rules intelligent AI agents can easily infer
- Restating what intelligent AI agents already know

---


## Examples

### From Claude Code's harness

#### Example

<before>
  CRITICAL REQUIREMENT - You MUST follow this:
    - After answering the user's question, you MUST include a "Sources:" section at the end of your response
    - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
    - This is MANDATORY - never skip including sources in your response
    - Example format:

      [Your answer here]

      Sources:
      - [Source Title 1](https://example.com/1)
      - [Source Title 2](https://example.com/2)

</before>

<after>
If you reference WebSearch results in your response, always append a "Sources:" section with Markdown hyperlinks: `- [Title](URL)`.
</after>

#### Example

<before>
Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.
</before>

<after>
Fast agent for fast codebase exploration. Can find files by wildcard patterns, search code, and answer both broad and focused codebase questions. Specify thoroughness: "quick", "medium", or "very thorough".
</after>

#### Example

This prompt attempted to list as many mutating actions as possible, but models like Opus are more than capable of understanding "READ-ONLY MODE" without so many explicit rules.

<before>
=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY planning task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to explore the codebase and design implementation plans. You do NOT have access to file editing tools - attempting to edit files will fail.
</before>

<after>
=== CRITICAL: READ-ONLY MODE ===
Planning only. NO file/directory creation, modification, or deletion. No Write/Edit/touch/rm/cp/mv/redirects/ln/mutations. No commands that change system state. Read-only Bash only.
</after>

#### Example

This prompt was slightly too verbose.

<before>
Be careful not to introduce security vulnerabilities such as command injection, XSS, SQL injection, and other OWASP top 10 vulnerabilities. If you notice that you wrote insecure code, immediately fix it.
</before>

<after>
Carefully avoid introducing vulnerabilities. What OWASP guidelines apply? Fix insecure code *immediately*.
</after>

#### Example

This prompt wasted tokens in an attempt to prohibit Claude Code from helping with malicious applications. But Claude models already extremely safe and have these safeguards baked in; Claude doesn't need additional prompting to reinforce this behavior.

<before>
IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.
</before>

<after>
</after>

#### Example

This slightly shrinks the LSP tool prompt. But mainly, it encourages Claude Code to use it **more**. This is a really useful tool that Claude underutilizes.

<before>
Interact with Language Server Protocol (LSP) servers to get code intelligence features.

Supported operations:

- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: Search for symbols across the entire workspace
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)
- incomingCalls: Find all functions/methods that call the function at a position
- outgoingCalls: Find all functions/methods called by the function at a position

All operations require:

- filePath: The file to operate on
- line: The line number (1-based, as shown in editors)
- character: The character offset (1-based, as shown in editors)

Note: LSP servers must be configured for the file type. If no server is available, an error will be returned.
</before>

<after>
Interact with Language Server Protocol (LSP) servers for code intelligence features. Very useful for refactoring and navigating the codebase! Use it a lot!

Supported operations:

- goToDefinition: Find symbol definition
- findReferences: Find references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols in a document
- workspaceSymbol: Search for symbols across the entire workspace
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)
- incomingCalls/outgoingCalls: Find all callers of/calls by the function at a position

All operations require:

- filePath: The file to operate on
- line: The line number (1-based, as shown in editors)
- character: The character offset (1-based, as shown in editors)

Note: LSP servers must be configured for the file type. If no server is available, an error will be returned.
</after>


### General prompt examples

#### Example

<before>
Blipsn2 is a rewrite and continuation of Blipsn, which did similar work but with a very different architecture. Blipsn's code was messy and incomplete, but you may find some value in referencing how it did things. Always review any Blipsn code and specs against this project's specs! NEVER copy and paste Blipsn code to Blipsn.
</before>

<after>
Blipsn2 rewrites Blipsn which was poorly designed and incomplete. Reference it for approach ideas and lessons, but always ground against Blipsn2 specs. Never directly copy code from Blipsn to Blipsn2.
</after>

#### Example

The original had some redundancy. Importantly, the new version doesn't get rid of the beneficial emphasis!

<before>
In most cases, you must fix lint issues and test coverage issues. For some packages, especially entrypoints, test coverage doesn't make sense; in these cases you may override the hook's behavior.

** DO NOT DO THIS WITHOUT CONSULTING THE USER! **

Create .go_quality.json in any package directory if the default test coverage threshold is unrealistic for a package.
</before>

<after>
Fix lint and test coverage issues, do not ignore them. For packages where coverage is unrealistic (typically entrypoints), consult the user about overriding via .go_quality.json. ** DO NOT TOUCH THIS WITHOUT CONSULTING THE USER! **
</after>

#### Example

<before>
- agents/ongoing-todo.md tracks ongoing todo items, areas of work, or requirement gaps that must be addressed.
- agents/ongoing-issues.md tracks ongoing known issues or temporary design trade-offs that warrant documentation but aren't necessarily bugs or immediate todos.
- agents/ongoing-done.md is an archive of completely resolved items from ongoing-todo.md and ongoing-issues.md. Don't drop any specifics when archiving.
</before>

<after>
- agents/ongoing-todo.md: todos, work areas, requirement gaps
- agents/ongoing-issues.md: known issues, temporary trade-offs worth documenting, areas to revisit
- agents/ongoing-done.md: archive of resolved items. Preserve specifics when archiving!
</after>

#### Example

<before>
Behavioral guidelines to reduce common LLM coding mistakes, derived from Andrej Karpathy's guidelines on LLM coding pitfalls.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.
</before>

<after>
Andrej Karpathy's guidelines on LLM coding pitfalls.

Note: These guidelines bias toward caution over speed. For trivial tasks, use judgment.
</after>

#### Example

This example did NOT reduce size, but it improved the prompt.

<before>
Understand the ultimate goal of the project and each area of code in it.
</before>

<after>
Remember ultimate project goals. Think carefully about relevant requirements in every layer, and how they'll impact future layers.
</after>

#### Example

This example also did NOT reduce size, but it improved the prompt by making the guidance more actionable for AI agents.

<before>
On any requirement conflicts, attempt reconciliation yourself (possibly using a subagent); apparent conflicts often dissolve with context. Failing that, the most recent human writing is likely authoritative. Genuine conflicts require user judgment; surface them. Once clarified, record to avoid confusion again.
</before>

<after>
On any requirement conflicts:
1. Attempt reconciliation yourself (possibly using a subagent); apparent conflicts often dissolve with context.
2. Failing that, the most recent human writing is likely authoritative. Genuine conflicts require user judgment; surface them.
3. Once clarified, record to avoid confusion again.
</after>

---


## Warning

As an AI agent yourself, **you will naturally tend to break these rules**. Following these guidelines will require rigorous reanalysis of everything you write. **You cannot read this skill and one-shot compliant content.** You will have to systematically check your work. It is not something you can check quickly or in just one pass.
