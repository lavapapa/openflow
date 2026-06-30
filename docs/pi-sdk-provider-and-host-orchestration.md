# Pi SDK Provider and Host Orchestration SDD

## Status

Draft for the local OpenFlow fork. This design is intentionally generic: host
applications such as Xiaobai Scholar can use it, but no host-specific concepts
belong in OpenFlow runtime, DSL validation, provider adapters, reports, or
artifacts.

## Problem

OpenFlow should be the workflow execution layer above agent runtimes. A host
application should not need to reimplement stage execution, human checkpoints,
parallel fan-out, resume/cache, provider events, or workflow artifacts.

The current CLI-provider model is useful, but host applications also need to run
an in-process SDK provider. Pi is the first target because its SDK exposes an
agent session, model registry, skill loading, context files, tool control, event
subscription, cancellation, and compaction.

## Non Goals

- Do not turn OpenFlow into a coding agent.
- Do not add Xiaobai Scholar specific fields or behavior.
- Do not make workflow scripts call arbitrary filesystem, process, or import
  APIs.
- Do not make OpenFlow own users, product sessions, artifact versions, billing,
  or product approval records.
- Do not model output guarantees that OpenFlow cannot enforce. Required files
  are a host/product contract, not proof that an LLM will comply.
- Do not implement context compression as a workflow skill. Compaction belongs
  to the agent harness/session layer.

## Layering

```text
Host product control plane
  owns users, sessions, product run state, billing, artifact versions

OpenFlow runtime
  owns workflow execution, agent scheduling, phase/human events,
  resume/cache, execution artifacts, reports, cancellation

Provider execution adapters
  own the concrete provider runtime boundary, either process or SDK

Pi SDK provider
  owns Pi AgentSession creation, model/provider selection, skill loading,
  workspace context files, tool policy, streaming events, compaction settings

Agent workspace
  owns files the agent reads/writes during one project or session
```

## Provider Execution Modes

OpenFlow currently treats providers as process adapters:

```ts
interface AgentAdapter {
  buildCommand(input: AgentRunInput): Promise<ProviderCommand>;
  parseResult(input: ProviderParseInput): Promise<ProviderParsedResult>;
}
```

The local fork should add a generic execution boundary without breaking process
adapters:

```ts
interface AgentExecutorAdapter {
  name: ProviderName;
  kind: "process" | "sdk";
  checkHealth?(): Promise<ProviderHealth>;
  execute(input: AgentRunInput, context: AgentExecutionContext): Promise<ProviderParsedResult>;
}
```

Process providers can be wrapped by a `ProcessAgentExecutorAdapter` that keeps
existing `buildCommand` and `parseResult` behavior. SDK providers can implement
`execute()` directly. All calls still flow through the scheduler and artifact
store.

## Agent DSL Additions

The DSL should stay provider-neutral and additive.

```ts
await agent({
  id: "review-methodology",
  provider: "pi",
  model: "deepseek-v4-pro",
  prompt: "Review the methodology section and write a concise handoff.",
  skills: [
    "skills/paper-review-methodology/SKILL.md",
    "skills/artifact-contract/SKILL.md"
  ],
  context: {
    files: [
      "input/context/context-pack.json",
      "input/paper.md"
    ],
    handoff: "working/context-review.md"
  },
  workspace: {
    cwd: ".",
    mode: "shared"
  },
  handoff: {
    writeTo: "working/methodology-review.md",
    instructions: "Summarize findings, uncertainty, and files touched."
  }
});
```

The field names deliberately avoid host-product concepts such as
`agentRunId`, `requiredSkills`, `ContextPack`, `expectedOutputs`, or
callback-style `onProgress`. Host applications may keep those concepts in their
own domain model, but OpenFlow only accepts generic orchestration inputs:
`skills`, `context`, `workspace`, `handoff`, provider, model, prompt, schema,
metadata, permissions, and timeout.

### `skills`

`skills` is a list of skill main documents or skill directories that must be
made visible to the agent at session startup. For Pi SDK, OpenFlow should force
these skills into the SDK resource loader. For CLI providers, OpenFlow may pass
provider-specific flags when supported, or inject a bounded prompt section that
asks the provider to read the listed files.

Rules:

- Paths are relative to workflow cwd unless absolute paths are explicitly
  allowed by host configuration.
- Paths must stay inside configured workspace roots by default.
- OpenFlow validates that the files exist before starting the provider.
- OpenFlow emits `agent.skill.attached` events with redacted paths and labels.
- Skills are capability instructions, not independent agents.
- Compaction/memory-management skills are discouraged and should fail a
  validation lint when marked as `layer: "harness"` in future metadata.

This is a hard context-loading mechanism: if a workflow attaches a skill main
document, the provider adapter should make that document visible before the
agent prompt is executed. The workflow author should not need to ask the model
to discover the skill by name.

### `model`

`model` remains first-class on every `agent()` call. Workflow authors can mix
models across stages. Config can still provide defaults and host overrides.

Precedence:

```text
agent({ model }) > workflow run override > provider config defaultModel > provider default
```

### `context`

`context` describes files and handoff inputs that should be available in the
agent workspace and mentioned to the provider in a structured way. It is not a
secret channel and must be written to run artifacts only after redaction and
size limiting.

Initial shape:

```ts
context?: {
  files?: string[];
  handoff?: string | string[];
  notes?: string;
}
```

For host integrations, these files are often upstream handoff documents,
material manifests, prior review notes, or product-level context packages. The
OpenFlow runtime should treat them as file references, not as typed host
objects.

### `workspace`

The filesystem is the primary substrate for agent work. OpenFlow should assume
that an agent works inside one cwd and reads/writes files through provider tools.

Initial shape:

```ts
workspace?: {
  cwd?: string;
  mode?: "shared" | "isolated";
}
```

For Xiaobai Scholar the host should use a shared session/project workspace for
the first workflow run and the follow-up Pi conversation. OpenFlow should not
create product-specific directory names; it only resolves the effective cwd.

### `handoff`

Do not pretend the runtime can guarantee LLM file outputs. Instead, give the
agent a handoff contract:

```ts
handoff?: {
  writeTo?: string;
  instructions?: string;
  required?: boolean;
}
```

OpenFlow can verify whether `writeTo` exists after the call. If missing and
`required` is true, the agent result fails with a clear error. If missing and
`required` is false, OpenFlow records a warning. This is a soft product-safe
contract, not an `expectedOutputs` fantasy.

When a workflow needs multiple product artifacts, the recommended pattern is
for the agent to write a handoff summary that references files it created or
updated. The host product can then collect, validate, version, and present those
files according to its own artifact contract.

## Events and Streaming

OpenFlow should support useful progress without requiring token-level streaming
from every provider.

Minimum:

- `phase.started`
- `phase.completed`
- `agent.started`
- `agent.skill.attached`
- `agent.context.attached`
- `agent.output` for provider stdout/stderr or SDK text deltas when available
- `agent.handoff.missing`
- `agent.completed`
- `human.pending` / `human.waiting` / `human.responded`

For SDK providers, `agent.output` may be emitted from SDK event subscription.
For expensive or noisy providers, adapters may throttle deltas or emit only
semantic progress. Host applications must tolerate both.

## Follow-up Conversation Boundary

OpenFlow owns bounded workflow execution. Once a workflow completes and the host
switches into an open-ended agent chat thread, the host may talk directly to Pi
AgentSession instead of going through OpenFlow.

Recommended host pattern:

1. User chooses a workflow entry.
2. Host starts an OpenFlow workflow in the session workspace.
3. OpenFlow calls Pi agents and writes handoff/output files.
4. Host records the workflow run as one coherent Pi-thread turn: the user side
   is the product-injected instruction plus user-provided material references;
   the assistant side is a concise completion message plus workflow handoff
   file references.
5. Later user chat continues directly in that same Pi thread.
6. Starting a new workflow entry creates a new bounded OpenFlow execution.

OpenFlow itself must not invoke the `openflow` CLI from inside an OpenFlow-run
Pi agent. Nested OpenFlow is forbidden by host policy because it creates hidden
recursion and unclear ownership.

## Security

- SDK provider env values are host-injected and must not be persisted in
  `run-input.json`, resolved config snapshots, reports, or events.
- Skill/context/handoff paths must be normalized and checked against cwd or
  host-allowed workspace roots.
- Agent output previews must be redacted and size-limited.
- `.openflow/runs` is execution evidence, not user-facing product artifact
  storage.
- Provider raw logs may contain source text and should be treated as sensitive.

## Migration Plan

1. Rebase strategy: start from upstream `v0.4.0`; keep the existing dirty local
   fork untouched; port local features as small patches.
2. Add SDD and contract tests for SDK provider execution, skill path validation,
   context path validation, model precedence, handoff verification, event
   emission, and secret redaction.
3. Add the generic provider execution boundary while preserving all process
   adapters.
4. Implement Pi SDK provider behind optional dependency or peer dependency.
5. Add SDK facade for host applications to run/resume workflows and consume
   async events.
6. Convert host workflows to real OpenFlow scripts.
7. Let hosts bridge OpenFlow events to product state without bypassing their own
   control planes.
