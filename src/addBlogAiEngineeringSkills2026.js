import dotenv from "dotenv";
import connectDb from "./config/db.js";
import { createBlogFromPayload } from "./services/blogCreation.service.js";

dotenv.config();

// One-off, non-destructive addition of a single blog post. Unlike
// blogSeed.js (which wipes the entire Blogs collection on every run), this
// reuses createBlogFromPayload — the same slug/id generation, content
// sanitization, and defaults the admin "New Blog" UI uses — so it only
// inserts this one post and errors (409) instead of overwriting anything
// if the slug already exists.

const content = `
<p>Software development has changed more in the last three years than in the previous fifteen. Generative AI models can now write, review, and refactor code. Coding agents can plan a task, execute it across multiple files, run tests, and iterate on failures with limited human input. For engineering leaders and individual contributors alike, this shift raises an uncomfortable but necessary question: what does it actually mean to be a skilled software engineer now?</p>

<p>The honest answer is that the fundamentals have not gone away &mdash; they have become more important, not less. A developer who hands a vague instruction to a coding agent and accepts whatever comes back is not practicing AI Engineering. They are gambling. The developers and organizations pulling ahead are the ones combining classic software engineering discipline with a new layer of skills: building AI-native applications, directing coding agents effectively, evaluating unpredictable systems rigorously, and shaping <em>what</em> gets built, not just how.</p>

<p>This article lays out a practical framework for what AI Engineering means in 2026, why it is broader than the job title &ldquo;AI Engineer,&rdquo; and a concrete roadmap for building these skills &mdash; whether you are a full-stack developer, a data engineer, a DevOps specialist, an engineering manager, or a CTO setting technical strategy.</p>

<p>A note on scope before we start: the AI field moves quickly, and specific tools, benchmarks, and vendor capabilities referenced below can shift within months. Treat tool names as illustrative rather than as an endorsement or a claim about current market share, and verify version-specific details against current documentation before making decisions based on them.</p>

<hr>

<h2>What Is AI Engineering?</h2>

<p>It helps to separate two things that get conflated constantly: <strong>AI Engineering as a skill set</strong> and <strong>&ldquo;AI Engineer&rdquo; as a job title</strong>.</p>

<p>The job title describes a relatively narrow role &mdash; someone whose primary responsibility is building AI systems, such as retrieval pipelines, model-serving infrastructure, or agentic applications. The skill set is much broader. In the same way that most developers today are expected to know how to work with cloud infrastructure without holding the title &ldquo;Cloud Engineer,&rdquo; most developers going forward will be expected to have AI Engineering capabilities regardless of their job title.</p>

<p>This matters for full-stack developers building AI-assisted features into existing products, for data engineers feeding retrieval systems and evaluation pipelines, for DevOps engineers operating agentic workloads in production, for traditional ML engineers extending their toolkit to include large language models, and for engineering managers who need to evaluate whether their teams are using these tools well.</p>

<p>The core distinction between AI applications and traditional software is worth stating plainly: <strong>traditional software behaves predictably given the same input, while AI systems &mdash; because they involve language models or learned statistical behavior &mdash; do not.</strong> That single difference cascades into nearly every skill discussed below: how you test, how you deploy, how you decide something is &ldquo;done,&rdquo; and how much you can trust an agent to work unsupervised.</p>

<hr>

<h2>The 7 Core AI Engineering Skills</h2>

<p>Below are seven capabilities that, taken together, define what it means to be strong at AI Engineering today. The first four describe the immediate, hands-on work of building with AI. The remaining three &mdash; evaluation and reliability, security and governance, and product and business thinking &mdash; describe the surrounding discipline that turns a working prototype into something an organization can trust and ship.</p>

<h3>1. Building and Deploying AI Applications</h3>

<p><strong>What it means.</strong> Working with the building blocks of modern AI systems: LLMs, prompt and context engineering, retrieval-augmented generation (RAG), agentic workflows, and &mdash; where relevant &mdash; traditional ML/deep learning.</p>

<p><strong>Why it matters.</strong> AI applications fail differently than traditional ones. A web service either returns the right value or errors out; an LLM-based feature can return a plausible-sounding but wrong answer, silently. Developers who miss this tend to either over-trust AI outputs or avoid AI capabilities that would have genuinely helped.</p>

<p><strong>What to know:</strong> how LLMs generate text and the practical tradeoffs that follow (context windows, latency, cost, hallucination risk); context engineering; RAG architecture and its specific failure modes (stale indexes, poor chunking, irrelevant retrieved context); agentic workflows and tool orchestration; and, importantly, when a simpler non-AI approach is the better engineering choice.</p>

<p><strong>Progression:</strong> <em>Beginner</em> &mdash; calls an LLM API for a single-turn task. <em>Intermediate</em> &mdash; builds a working RAG pipeline and manages cost/latency/quality tradeoffs. <em>Advanced</em> &mdash; designs multi-agent systems and debugs subtle context/retrieval failures end to end.</p>

<h3>2. Software Engineering Fundamentals</h3>

<p><strong>What it means.</strong> System design, data modeling, testing strategy, version control, security fundamentals, and the tradeoffs between cost, scalability, reliability, and speed.</p>

<p><strong>Why it matters.</strong> There's a narrative that AI makes fundamentals less relevant because &ldquo;the AI writes the code.&rdquo; The opposite appears true: an engineer who deeply understands architecture and tradeoffs can direct a coding agent with precision and catch bad decisions early. Without that grounding, a developer can't tell working code from sound code &mdash; and can't give an agent the context it needs to do good work.</p>

<p><strong>What to know:</strong> architecture patterns and the reasoning behind them; data modeling; testing strategy adapted for non-deterministic components; version control suited to fast iteration; security and privacy fundamentals, especially around data flowing into AI pipelines.</p>

<p><strong>Progression:</strong> <em>Beginner</em> &mdash; comfortable with core programming, testing, version control. <em>Intermediate</em> &mdash; designs system architecture and infrastructure choices independently. <em>Advanced</em> &mdash; evaluates tradeoffs at scale and translates fuzzy requirements into a sound technical spec.</p>

<h3>3. Using Coding Agents</h3>

<p><strong>What it means.</strong> Directing agentic coding tools effectively &mdash; understanding how they reason, where they fail, and how to supervise them without micromanaging or over-trusting.</p>

<p><strong>Why it matters.</strong> Coding agents can now plan multi-step tasks, edit across files, run tests, and self-correct. Used well, they meaningfully increase throughput. Used poorly &mdash; vague instructions, no verification &mdash; they produce code that looks finished but isn't, occasionally with serious consequences (e.g., against a production database).</p>

<p><strong>What to know:</strong> context management (too little or too much both hurt output quality); when to have an agent plan before executing; building in verifiers so the agent checks its own work; when a written spec is worth the time; multi-agent orchestration; and guardrails against irreversible actions without explicit approval.</p>

<p><strong>Progression:</strong> <em>Beginner</em> &mdash; uses an agent for small, supervised tasks. <em>Intermediate</em> &mdash; manages context and specs deliberately, builds verification loops. <em>Advanced</em> &mdash; orchestrates multiple agents on complex projects and continuously updates workflow as tools evolve.</p>

<p>Because these tools improve quickly, specific capabilities and best practices can go stale within months &mdash; this skill includes an ongoing habit of re-testing assumptions, not a checklist mastered once.</p>

<h3>4. Shaping the Build</h3>

<p><strong>What it means.</strong> As agents get better at implementing a clear spec, an engineer's highest-leverage work shifts earlier &mdash; to deciding what the spec should say.</p>

<p><strong>Why it matters.</strong> Engineers historically implemented a design handed to them. That division of labor is loosening. Developers who understand product goals and user needs are positioned to participate in &mdash; or drive &mdash; decisions about what gets built, not just how.</p>

<p><strong>What to know:</strong> product sense; judgment about when to ship a fast MVP versus build carefully; translating ambiguous business goals into a precise spec; and taking ownership of opportunities rather than waiting to be assigned them.</p>

<p><strong>Progression:</strong> <em>Beginner</em> &mdash; implements a well-defined spec accurately. <em>Intermediate</em> &mdash; writes a clear spec from a fuzzy requirement. <em>Advanced</em> &mdash; drives prioritization and balances speed against thoroughness based on real business risk.</p>

<h3>5. AI Evaluation and Reliability</h3>

<p><strong>What it means.</strong> Measuring whether an AI system actually works &mdash; and keeps working &mdash; through structured evaluations (&ldquo;evals&rdquo;), error analysis, and monitoring, rather than relying on &ldquo;it seemed fine when I tried it.&rdquo;</p>

<p><strong>Why it matters.</strong> Because outputs are unpredictable, casual testing isn't evidence of reliability. Teams that skip rigorous evaluation tend to discover failure modes in production, from customers &mdash; the most expensive place to find them.</p>

<p><strong>What to know:</strong> designing eval sets that reflect real usage, not just easy cases; systematic error analysis to find patterns rather than chasing individual symptoms; the difference between offline evaluation and online monitoring; regression testing so a prompt or model change doesn't silently break something that worked before; and human-in-the-loop review for high-stakes outputs.</p>

<p><strong>Progression:</strong> <em>Beginner</em> &mdash; manually spot-checks outputs. <em>Intermediate</em> &mdash; builds structured eval sets as part of the dev cycle. <em>Advanced</em> &mdash; runs continuous evaluation and monitoring pipelines and treats evals as a first-class engineering artifact.</p>

<h3>6. AI Security and Governance</h3>

<p><strong>What it means.</strong> Understanding security and compliance risks specific to AI systems &mdash; prompt injection, data leakage through context, over-permissioned agents, and regulatory obligations &mdash; and building safeguards accordingly.</p>

<p><strong>Why it matters.</strong> AI systems introduce attack surfaces traditional software doesn't have. An agent with tool access and unfiltered external input is a fundamentally different risk than a static form. As AI systems take more autonomous action, the cost of a security gap rises accordingly.</p>

<p><strong>What to know:</strong> prompt injection and how untrusted content can attempt to hijack an agent's instructions; least-privilege design; data handling and privacy when sending information to third-party models; general awareness that AI regulation varies by jurisdiction and is still evolving (verify specifics with current legal guidance rather than assuming); and auditability &mdash; reconstructing what an agent did and why.</p>

<p><strong>Progression:</strong> <em>Beginner</em> &mdash; aware AI systems carry distinct risks. <em>Intermediate</em> &mdash; applies least-privilege and basic injection safeguards. <em>Advanced</em> &mdash; designs governance frameworks, audit trails, and approval workflows for high-risk actions.</p>

<h3>7. Product and Business Thinking</h3>

<p><strong>What it means.</strong> Connecting technical work to business outcomes &mdash; understanding what a feature is for, who it serves, and how to measure whether it succeeded.</p>

<p><strong>Why it matters.</strong> This extends &ldquo;shaping the build&rdquo; into an ongoing habit of thinking about ROI, opportunity cost, and customer impact throughout a feature's lifecycle, not just at the scoping stage.</p>

<p><strong>What to know:</strong> basic business literacy about how the organization creates value; framing technical proposals in terms leadership can evaluate (cost, risk, timeline, impact); and choosing meaningful success metrics, since traditional metrics don't always translate cleanly to AI features.</p>

<p><strong>Progression:</strong> <em>Beginner</em> &mdash; understands the immediate purpose of the feature being built. <em>Intermediate</em> &mdash; independently frames proposals in business terms. <em>Advanced</em> &mdash; shapes technical strategy and balances engineering effort against business priority.</p>

<hr>

<h2>AI Engineering vs. Traditional Software Engineering</h2>

<table>
<thead>
<tr><th>Dimension</th><th>Traditional Software Engineering</th><th>AI Engineering</th></tr>
</thead>
<tbody>
<tr><td>Output predictability</td><td>Deterministic &mdash; same input, same output</td><td>Probabilistic &mdash; outputs vary and require statistical evaluation</td></tr>
<tr><td>Primary quality tool</td><td>Unit/integration tests with fixed expected outputs</td><td>Evals, error analysis, and continuous monitoring</td></tr>
<tr><td>Core skill for &ldquo;correctness&rdquo;</td><td>Debugging logic errors</td><td>Debugging context, prompts, retrieval quality, and model behavior</td></tr>
<tr><td>Main risk surface</td><td>Logic bugs, infrastructure failures</td><td>The above, plus hallucination, prompt injection, and unpredictable agent actions</td></tr>
<tr><td>Spec-to-code process</td><td>Engineer writes most code directly from a spec</td><td>Engineer increasingly shapes and refines the spec; agent implements a large share of the code</td></tr>
<tr><td>Role of fundamentals</td><td>Necessary for building the system</td><td>Necessary for building the system <em>and</em> for directing AI tools effectively</td></tr>
<tr><td>Learning curve shape</td><td>Skills accumulate steadily</td><td>Skills accumulate on fundamentals, but tool-specific practices change quickly and require ongoing relearning</td></tr>
</tbody>
</table>

<p>The table's most important row is the last one. AI Engineering does not replace the steady, cumulative skill-building of traditional software engineering &mdash; it adds a layer on top that requires continuous adaptation, because the tools themselves are still evolving rapidly.</p>

<hr>

<h2>The Rise of Coding Agents</h2>

<p>It's useful to think of this as an evolution across three stages.</p>

<p><strong>Traditional coding.</strong> The developer writes every line, using an IDE primarily for syntax help, autocomplete, and navigation. All planning and execution happens in the developer's head.</p>

<p><strong>AI-assisted coding.</strong> The developer uses AI to generate snippets, functions, or explanations on request, but remains the one driving each step, reviewing each suggestion in real time before accepting it.</p>

<p><strong>Agentic coding.</strong> The developer specifies a goal &mdash; sometimes a small one, sometimes a large multi-file task &mdash; and an agent plans, executes, tests, and iterates with reduced step-by-step supervision, checking back in at defined points or when it gets stuck.</p>

<p>Working well within agentic coding requires a distinct set of practices:</p>

<ul>
<li><strong>Context management</strong> &mdash; giving the agent the right information without overwhelming it with irrelevant detail, which measurably degrades output quality.</li>
<li><strong>Planning</strong> &mdash; deciding upfront whether the agent should produce a plan for review before executing, particularly for larger or riskier tasks.</li>
<li><strong>Specification</strong> &mdash; writing a clear enough description of the desired outcome that the agent has a real target, while recognizing that over-specifying trivial tasks wastes time.</li>
<li><strong>Tool use</strong> &mdash; understanding what tools and systems the agent can access, and constraining that access appropriately.</li>
<li><strong>Verification</strong> &mdash; building in automated checks (tests, evals, linters) so the agent can catch its own mistakes rather than relying solely on human review.</li>
<li><strong>Testing</strong> &mdash; treating agent-authored code with the same testing rigor as human-authored code, not less.</li>
<li><strong>Iteration</strong> &mdash; expecting and planning for multiple passes rather than treating the first output as final.</li>
<li><strong>Human oversight</strong> &mdash; knowing which decisions require a human sign-off (schema changes, production deployments, anything irreversible) and which don't.</li>
<li><strong>Multi-agent workflows</strong> &mdash; for larger projects, coordinating multiple agents working on different parts of a system, with a clear owner for integration.</li>
</ul>

<p>The central point worth emphasizing: <strong>coding agents raise the importance of software engineering knowledge, they do not lower it.</strong> An agent will happily implement a poorly-reasoned architecture just as fast as a well-reasoned one. The judgment about which is which still has to come from a human who understands the fundamentals.</p>

<hr>

<h2>From Vibe Coding to AI Engineering</h2>

<p>&ldquo;Vibe coding&rdquo; &mdash; casually prompting an AI to generate code, accepting the output largely on faith, and moving on &mdash; has a real place. It's fast, useful for throwaway prototypes, and genuinely lowers the barrier to experimentation.</p>

<p>It is not, however, the same activity as AI Engineering, and treating it as interchangeable is where teams get into trouble. The differences:</p>

<table>
<thead>
<tr><th></th><th>Vibe Coding</th><th>AI Engineering</th></tr>
</thead>
<tbody>
<tr><td>Verification</td><td>Often none, or a quick manual glance</td><td>Structured evals, tests, and error analysis</td></tr>
<tr><td>Context given to the AI</td><td>Minimal, ad hoc</td><td>Deliberately engineered and scoped</td></tr>
<tr><td>Suitable for</td><td>Prototypes, throwaway scripts, learning</td><td>Production systems, anything customer-facing or business-critical</td></tr>
<tr><td>Risk tolerance</td><td>High &mdash; mistakes are cheap and reversible</td><td>Low &mdash; mistakes can be costly, public, or irreversible</td></tr>
<tr><td>Underlying skill required</td><td>Minimal</td><td>Deep software engineering and AI-specific judgment</td></tr>
</tbody>
</table>

<p>The practical implication for teams: it's fine &mdash; even valuable &mdash; to vibe code a proof of concept over a weekend. It is a mistake to ship that proof of concept to production without the discipline described throughout this article. The gap between the two is exactly where AI Engineering skills live.</p>

<hr>

<h2>The AI Engineering Learning Roadmap</h2>

<p>A practical six-stage path for building these skills, roughly in order of dependency (later stages assume earlier ones).</p>

<table>
<thead>
<tr><th>Stage</th><th>Skills</th><th>Technologies/Concepts</th><th>Practical Project</th><th>Expected Outcome</th></tr>
</thead>
<tbody>
<tr><td><strong>1. Software Engineering</strong></td><td>Programming fundamentals, data structures, system design, testing, version control, basic security</td><td>A primary language, Git, relational/non-relational databases, REST/API design</td><td>Build and deploy a small full-stack app with a real database and automated tests</td><td>Can independently design, build, and maintain a small production-quality system</td></tr>
<tr><td><strong>2. AI Foundations</strong></td><td>How LLMs work practically, prompt engineering, basic evaluation</td><td>LLM APIs, prompting techniques, context window basics</td><td>Build a simple LLM-powered feature (e.g., summarizer) with a basic eval set</td><td>Can build a functioning single-purpose AI feature and explain its failure modes</td></tr>
<tr><td><strong>3. AI Application Engineering</strong></td><td>RAG architecture, context engineering, cost/latency/quality tradeoffs</td><td>Vector databases, embeddings, chunking strategies, retrieval evaluation</td><td>Build a RAG app over a real document set, evaluating retrieval and answer quality separately</td><td>Can design and debug a retrieval-augmented application end to end</td></tr>
<tr><td><strong>4. Agentic AI</strong></td><td>Multi-step reasoning, tool use, orchestration</td><td>Agent frameworks, function/tool calling, memory/state management</td><td>Build an agent completing a multi-step task with &ge;2 tools and guardrails against destructive actions</td><td>Can design agentic workflows with appropriate safeguards</td></tr>
<tr><td><strong>5. Coding Agents</strong></td><td>Directing agents, context management, spec-writing, verification design</td><td>Agentic coding tools, sandboxed dev environments, automated test pipelines</td><td>Use a coding agent to implement a feature from a spec, with a test suite it must pass</td><td>Can supervise a coding agent efficiently, catching bad decisions early</td></tr>
<tr><td><strong>6. AI Product Engineering</strong></td><td>Product sense, spec-shaping, evaluation at scale, governance judgment</td><td>Production monitoring/observability, structured eval frameworks, approval workflows</td><td>Take an AI feature from spec through deployment and post-launch monitoring</td><td>Can own an AI feature end to end, including a plan for failure</td></tr>
</tbody>
</table>

<hr>

<h2>AI Engineering Skills Matrix</h2>

<table>
<thead>
<tr><th>Skill</th><th>Beginner</th><th>Intermediate</th><th>Advanced</th><th>Production-Level Capability</th></tr>
</thead>
<tbody>
<tr><td>Building/deploying AI apps</td><td>Calls an LLM API for a single task</td><td>Builds a working RAG pipeline</td><td>Designs multi-agent systems</td><td>Operates AI applications reliably at scale with monitoring</td></tr>
<tr><td>Software engineering fundamentals</td><td>Writes tested, version-controlled code</td><td>Designs system architecture</td><td>Evaluates complex tradeoffs, mentors others</td><td>Sets technical standards across a team or org</td></tr>
<tr><td>Using coding agents</td><td>Uses an agent for small, supervised tasks</td><td>Manages context and specs deliberately</td><td>Orchestrates multi-agent workflows</td><td>Establishes team-wide agentic coding practices and guardrails</td></tr>
<tr><td>Shaping the build</td><td>Implements a given spec</td><td>Writes specs from fuzzy requirements</td><td>Drives prioritization and scope decisions</td><td>Owns product direction for an AI-powered area</td></tr>
<tr><td>AI evaluation and reliability</td><td>Manually spot-checks outputs</td><td>Builds structured eval sets</td><td>Runs continuous eval/monitoring pipelines</td><td>Establishes evaluation standards across systems</td></tr>
<tr><td>AI security and governance</td><td>Aware of AI-specific risks</td><td>Applies least-privilege and injection safeguards</td><td>Designs governance frameworks</td><td>Sets organization-wide AI security policy</td></tr>
<tr><td>Product and business thinking</td><td>Understands feature purpose</td><td>Frames proposals in business terms</td><td>Shapes technical strategy</td><td>Aligns AI investment with business outcomes at a leadership level</td></tr>
</tbody>
</table>

<hr>

<h2>What Companies Need to Do</h2>

<p>Organizations cannot simply purchase AI tools and expect these skills to develop on their own. A few practical steps matter more than others:</p>

<ul>
<li><strong>Invest in fundamentals, not just tool training.</strong> Teaching a team to use a specific coding agent is far less durable than strengthening the software engineering judgment that makes any coding agent more effective.</li>
<li><strong>Create space for structured evaluation, not just shipping speed.</strong> Teams under constant deadline pressure tend to skip the eval and error-analysis work described above &mdash; precisely the work that prevents expensive production failures.</li>
<li><strong>Set clear guardrails for agentic tools early</strong>, particularly around production data access and irreversible actions, rather than discovering the gap after an incident.</li>
<li><strong>Treat this as a continuous-learning problem, not a one-time training event.</strong> Because agentic tools and best practices change quickly, a single onboarding session will be outdated within months.</li>
<li><strong>Give engineers real product context.</strong> &ldquo;Shaping the build&rdquo; as a skill only develops when engineers are actually given the opportunity &mdash; and trust &mdash; to participate in decisions about what gets built.</li>
</ul>

<hr>

<h2>The Future of AI Engineering</h2>

<p>The role of the software engineer is shifting, not disappearing. The center of gravity is moving earlier in the development lifecycle:</p>

<p><strong>Problem definition &rarr; specification &rarr; architecture &rarr; AI-assisted implementation &rarr; evaluation &rarr; deployment &rarr; iteration.</strong></p>

<p>Writing every line of code is becoming a smaller share of an engineer's actual value. Framing the right problem, writing a specification precise enough to direct AI tools effectively, designing sound architecture, rigorously evaluating what comes back, and iterating based on real evidence &mdash; these are becoming the differentiators.</p>

<p>This is not a reason for concern about the value of engineering skill. If anything, it raises the ceiling on what a single skilled engineer, or a small team, can accomplish. The floor for producing <em>something</em> that runs has dropped. The floor for producing something reliable, secure, and genuinely useful has not &mdash; and the skills described in this article are what separate the two.</p>

<hr>

<h2>Conclusion</h2>

<p>AI Engineering is not a shortcut around software engineering, and it is not a single tool or certification. It is the combination of solid engineering fundamentals, fluency in AI-native application patterns, skillful direction of coding agents, disciplined evaluation, security-conscious design, and genuine product judgment.</p>

<p>The developers who will be most valuable in the years ahead are not necessarily the ones who adopted the newest tool first. They are the ones who understand <em>why</em> a system behaves the way it does, can direct AI tools with precision because of that understanding, and can be trusted to ship something that actually works &mdash; not just something that appeared to work in a demo.</p>

<p>This is the perspective that shapes how Technohana approaches technical training: not &ldquo;learn this tool,&rdquo; but build the underlying judgment that makes any tool &mdash; current or future &mdash; genuinely useful in your hands. Technohana's AI Engineering, Generative AI, and Agentic AI training programs are built around that same progression, from software engineering fundamentals through production-grade AI systems.</p>

<p><em>This article's framing draws on and extends a four-skill structure for AI Engineering (building/deploying AI applications, software engineering fundamentals, using coding agents, and shaping the build) originally articulated by Andrew Ng in a DeepLearning.AI newsletter letter. Technohana's seven-skill framework builds on that foundation with three additional dimensions &mdash; AI evaluation and reliability, AI security and governance, and product and business thinking.</em></p>
`.trim();

const faqs = [
  {
    question: 'What is the difference between "AI Engineering" and being an "AI Engineer"?',
    answer:
      '"AI Engineer" is a job title for someone whose primary role is building AI systems. AI Engineering is a broader skill set that developers across many roles — full-stack, data, DevOps, ML — increasingly need, regardless of their specific job title.',
  },
  {
    question: "Do coding agents make traditional software engineering skills less important?",
    answer:
      "No — the evidence points the other way. Coding agents can implement a specification quickly, but they can't judge whether that specification reflects sound architecture, security practices, or business priorities. That judgment still requires strong software engineering fundamentals.",
  },
  {
    question: 'What\'s the difference between "vibe coding" and AI Engineering?',
    answer:
      "Vibe coding is casually prompting an AI for code with little verification — fine for prototypes, risky for production. AI Engineering applies deliberate context management, evaluation, and testing discipline, and is appropriate for systems that matter.",
  },
  {
    question: "Where should someone start if they're new to AI Engineering?",
    answer:
      "With software engineering fundamentals — programming, system design, and testing — before layering on AI-specific skills like prompt engineering, RAG, and agentic workflows. Skipping the fundamentals tends to produce fragile results.",
  },
  {
    question: "How often do AI Engineering best practices change?",
    answer:
      "Frequently. Foundational skills (software engineering, evaluation design, security judgment) are durable, but tool-specific practices for coding agents and AI frameworks can shift within months, so ongoing learning is part of the skill itself rather than a one-time investment.",
  },
];

async function run() {
  try {
    await connectDb();
    console.log("✅ Connected to MongoDB");

    const blog = await createBlogFromPayload({
      title: "The AI Engineering Skills You Need to Master in 2026",
      slug: "ai-engineering-skills-2026-roadmap",
      author: "Abdul Salam",
      date: "15 August 2026",
      category: "AI Engineering",
      content,
      excerpt:
        "Discover the 7 core AI Engineering skills for 2026 — from coding agents to AI evaluation and governance — plus a practical 6-stage learning roadmap.",
      metaTitle: "AI Engineering Skills for 2026: The Complete Roadmap | Technohana",
      metaDescription:
        "Discover the 7 core AI Engineering skills for 2026 — from coding agents to AI evaluation and governance — plus a practical 6-stage learning roadmap.",
      focusKeyword: "AI Engineering skills 2026",
      tags: [
        "AI Engineer roadmap",
        "AI Engineering roadmap 2026",
        "coding agents",
        "Agentic AI",
        "AI application development",
        "AI software engineering",
        "AI engineering training",
      ],
      readTimeMin: 18,
      faqs,
      contentType: "authority-article",
    });

    console.log(`🌱 Blog created: id=${blog.id} slug=${blog.slug} (published=${blog.published})`);
    console.log("   Publish it via the admin UI (/admin/blogs) or PATCH /admin/blogs/:id/publish when ready.");
    process.exit();
  } catch (error) {
    console.error("❌ Error adding blog:", error.message);
    process.exit(1);
  }
}

run();
