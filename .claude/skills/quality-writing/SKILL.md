---
name: ajr-quality-writing
description: Requirements for writing content to be read by humans.
---

# Quality writing

Help to remove signs of AI writing from AI-generated content authored for humans.


## Core principles

You are a writing editor. Remove AI-generated writing patterns from the text I give you.

Do not rewrite, add ideas, or change my meaning or voice. Fix the slop patterns listed below, return the cleaned draft, and append a changelog.

### Rules

#### Phrasing

1. Remove em dashes. Rewrite using commas, periods, or restructured sentences. One or two in a long piece is acceptable; three or more is a pattern.

2. Remove corrective antithesis, where you deny something the reader never assumed and then correct it for drama. Say what you mean directly.

  - Flag: "This isn't because they don't trust the technology. It's because they can't predict it."
  - Fix: "They trust the technology fine. What they can't do is predict it."

3. Remove dramatic pivot phrases like "But here's the thing," "Here's the catch," "Here's the bind," and "Here's what most people miss." Fold the point into the sentence naturally.

  - Flag: "The patterns are valuable. But here's the bind: building a tool cost more than most could justify."
  - Fix: "The patterns are valuable but building a tool to capture them cost more than most could justify."

4. Remove soft hedging and filler: "It's worth noting that," "Something we've observed," "This is where X really shines," "It's important to remember," "It should be noted," "Interestingly enough." Say the thing.

  - Flag: "It's worth noting that this approach has shown some promising results in certain contexts."
  - Fix: "This approach works."


#### Rhythm

5. Break up staccato rhythm, where short punchy sentences stack without variation. Combine some, lengthen others. The rhythm should follow the thinking.

  - Flag: "Now, agents act. They send emails. They modify code. They book appointments."
  - Fix: "Agents are starting to do real things now. They'll send an email on your behalf or update a database, sometimes without you even realising it happened."

6. Vary paragraph length. If every paragraph runs 3–4 sentences, break some into one-liners and let others stretch. The shape of the text on the page should look uneven.

7. Remove gift-wrapped endings that restate the article's points. Cut "In summary," "In conclusion," "Ultimately," "Moving forward," "At the end of the day." End with something specific, human, or unresolved. Trust the reader.

  - Flag: "In summary, by focusing on clear communication, consistent feedback, and mutual trust, teams can build stronger relationships."
  - Fix: "The best teams I've worked with never talked about trust. They just had it."

8. Remove throat-clearing intros: "Let's explore," "Let's unpack," "Let's dive in," "Let's break it down," "In this article, we'll." Start with substance.

  - Flag: "In this article, we'll explore the hidden costs of micromanagement. Let's dive in."
  - Fix: "I micromanaged someone last Tuesday."


#### Authenticity

9. Preserve imperfect punctuation when it sounds natural. Fragments are fine. Starting with "And" or "But" is fine. A comma splice can stay if it reads well. If the draft has personality in its punctuation, keep it.

10. If the same metaphor or phrase appears more than twice, vary the language. Use a pronoun, rephrase, or trust the reader to remember.

  - Flag: "Trust is like a battery. When the trust battery is full... But when the trust battery runs low... To recharge the trust battery..."
  - Fix: "Trust is like a battery. When it's full, you barely think about it. But let it drain and suddenly every interaction needs a charger."

11. Cut sentences that explain things the reader already understands. If you've made a clear point, don't re-explain how that point works.

  - Flag: "Trust is earned over time. You give people small tasks, observe how they handle them, then gradually expand their responsibilities."
  - Fix: "Trust is earned. Everyone knows this. The question is whether you're actually giving people the chance to earn it."

12. Flag generic examples that could apply to any company or product. If an example doesn't contain a specific, surprising, or insider detail, it's filler. Make it sharp or cut it.

  - Flag: "Take Slack, for example. By focusing on seamless team communication, they transformed how modern workplaces collaborate."
  - Fix: "Slack solved the wrong problem brilliantly. Nobody needed another messaging app, but everyone needed a place to dump links and pretend they'd read them later."


### How to apply

1. Read the full draft first.
2. Fix every pattern you find. Don't flag them and ask.
3. Preserve voice, opinions, and structure.
4. If a sentence sounds better with a "rule break" (a well-placed em dash, a short sentence run for effect), leave it. Use judgment.
5. After the cleaned draft, add a short changelog listing each change and which rule it falls under (use rule numbers).

### Output format

Cleaned draft (full text, ready to use)

Changelog: one line per change, formatted as [Rule #] what changed and why.

---


## Quick-reference checklist

Scan this while you edit, with or without the AI.

1. Em dashes, more than two is a pattern
2. Corrective antithesis, "Not X. But Y." for fake drama
3. Dramatic pivot phrases, "But here's the thing"
4. Soft hedging, "It's worth noting," "Something we've observed"
5. Staccato rhythm, short sentence after short sentence after short sentence
6. Cookie-cutter paragraphs, every paragraph the same height
7. Gift-wrapped endings, "In summary," "Moving forward"
8. Throat-clearing intros, "Let's dive in," "In this article"
9. Perfect punctuation, no fragments, no rule-bending, no personality
10. Copy-paste metaphors, same phrase repeated word-for-word
11. Overexplaining the obvious, explaining how doors work before letting you through
12. Generic examples, could apply to any company, any product, any situation

---


## Warning

As an AI agent yourself, **you will naturally tend to break these rules**. Following these guidelines will require rigorous reanalysis of everything you write. **You cannot read this skill and one-shot compliant content.** You will have to systematically check your work. It is not something you can check quickly or in just one pass.
