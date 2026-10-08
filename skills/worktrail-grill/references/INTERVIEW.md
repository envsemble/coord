# Interview Method

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), investigate it with available tools; use a bounded sub-agent exploration when delegation is available, authorized, and useful. Don't ask the user for anything you could look up yourself. A running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the result; ask the rest of the frontier now when independent exploration is possible. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every relevant branch of the design tree visited, nothing left silently assumed. Do not enact unsettled choices until the user confirms shared understanding. Already settled choices and existing authorization remain valid; do not manufacture a confirmation or an interview for a clear direct coding request. Record the agreement without treating plan acceptance as implementation completion or an implicit invocation of worktrail-implement.
