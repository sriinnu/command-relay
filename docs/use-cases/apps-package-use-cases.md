# CommandRelay App/Package Use Cases

This document explains when to use each app/package in this repository, who it is for, and when not to use it.

## How to choose quickly

If you are:

- Building or operating CommandRelay UX: start with `@commandrelay/tui`, `@commandrelay/client`, and `@commandrelay/relay-proxy`.
- Solving HTTP proxy behavior in apps/libs: start with `@commandrelay/proxy-core`, then choose one adapter package (`proxy-fetch`, `proxy-axios`, `proxy-got`, `proxy-undici`, or `proxy-http-client`).
- Implementing long-running local jobs: use `@commandrelay/run-orchestrator` with `@commandrelay/run-core`.
- Implementing terminal backend integrations: use `@commandrelay/runtime-core` plus one backend adapter (`runtime-tmux`, `runtime-cmux`, `runtime-managed`, `runtime-ssh`).
- Selecting terminals/backends at runtime: use `@commandrelay/terminal-discovery`.
- Sharing protocol contracts between bridge/client tools: use `@commandrelay/protocol`.

## Package-by-package guidance

### `@commandrelay/cli-proxy` (`packages/cli-proxy`)

- What it does: CLI diagnostics for proxy environment inspection and route explanation.
- Best use cases:
  - CI checks for proxy env correctness.
  - Operator troubleshooting when requests route unexpectedly.
  - Scriptable policy explanation output for incidents.
- Use this when:
  - You need human-readable and JSON proxy diagnostics quickly.
- Avoid this when:
  - You need an in-process library API only (use `@commandrelay/proxy-core` or adapter packages).

### `@commandrelay/client` (`packages/commandrelay-client`)

- What it does: typed WebSocket client primitives for CommandRelay.
- Best use cases:
  - Building CLI/TUI or service-side clients against bridge protocol.
  - Reusing connection/auth/request patterns with strong typing.
  - Handling output/error stream events consistently.
- Use this when:
  - You are writing a consumer of the CommandRelay WebSocket API.
- Avoid this when:
  - You only need protocol schema types (use `@commandrelay/protocol`).

### `@commandrelay/protocol` (`packages/commandrelay-protocol`)

- What it does: shared WebSocket protocol schema/contracts.
- Best use cases:
  - Contract validation between server and client packages.
  - Strict protocol parsing and message-shape compatibility tests.
  - Stable envelope typing in multi-package integrations.
- Use this when:
  - You need a canonical source of protocol truth.
- Avoid this when:
  - You need to make actual network calls (use `@commandrelay/client`).

### `@commandrelay/relay-proxy` (`packages/commandrelay-relay-proxy`)

- What it does: controlled WebSocket relay exposing a single `/ws` endpoint.
- Best use cases:
  - Exposing bridge traffic through a hardened proxy boundary.
  - Enforcing token/origin constraints in front of upstream bridge.
  - Operating one ingress endpoint for clients.
- Use this when:
  - You need an operational relay layer with policy controls.
- Avoid this when:
  - You only need client SDK behavior (use `@commandrelay/client`).

### `@commandrelay/tui` (`packages/commandrelay-tui`)

- What it does: cross-platform terminal UI for CommandRelay.
- Best use cases:
  - Interactive operator control over sessions and panes.
  - Human-first workflow for connect/auth/attach/input operations.
  - Ops workflows where visual state and quick controls matter.
- Use this when:
  - Humans are driving terminal operations interactively.
- Avoid this when:
  - You are building automation-only workflows (use client/libs).

### `@commandrelay/proxy-agent` (`packages/proxy-agent`)

- What it does: protocol-aware proxy agent factory for HTTP/HTTPS/SOCKS/PAC.
- Best use cases:
  - Centralizing agent creation for many HTTP consumers.
  - Applying one proxy policy to mixed target protocols.
  - Reducing duplicated proxy-agent wiring.
- Use this when:
  - You need generic proxy-agent construction utilities.
- Avoid this when:
  - You want framework-specific wrappers (use `proxy-axios`, `proxy-got`, `proxy-undici`).

### `@commandrelay/proxy-axios` (`packages/proxy-axios`)

- What it does: Axios-oriented proxy resolver/config helpers without runtime lock-in.
- Best use cases:
  - Axios client stacks requiring env-proxy correctness.
  - Standardized proxy config in multiple Axios callers.
  - Sharing proxy setup logic across services.
- Use this when:
  - Axios is your HTTP layer.
- Avoid this when:
  - You do not use Axios (pick fetch/got/undici variants).

### `@commandrelay/proxy-core` (`packages/proxy-core`)

- What it does: base proxy resolution policy and env parsing.
- Best use cases:
  - Implementing `http_proxy`/`https_proxy`/`all_proxy`/`no_proxy` logic once.
  - Building adapter packages with deterministic route decisions.
  - Reusing proxy-policy semantics across tools.
- Use this when:
  - You want pure policy logic with minimal coupling.
- Avoid this when:
  - You need a full HTTP client abstraction (use `proxy-http-client` or adapter package).

### `@commandrelay/proxy-fetch` (`packages/proxy-fetch`)

- What it does: proxy-aware fetch wrappers with JSON/timeout safety controls.
- Best use cases:
  - Safe fetch calls with max-response and timeout guardrails.
  - Consistent proxy behavior for fetch-based callers.
  - Thin wrappers around native/web-compatible fetch workflows.
- Use this when:
  - Your codebase is fetch-first and you want guardrails built in.
- Avoid this when:
  - You use Axios/Got/Undici directly.

### `@commandrelay/proxy-got` (`packages/proxy-got`)

- What it does: Got-friendly proxy resolver and option helpers.
- Best use cases:
  - Injecting proxy behavior into Got clients.
  - Reusing config helper logic for Got-heavy services.
  - Maintaining policy parity with other proxy adapters.
- Use this when:
  - Got is the HTTP stack.
- Avoid this when:
  - You do not use Got.

### `@commandrelay/proxy-http-client` (`packages/proxy-http-client`)

- What it does: proxy-aware JSON HTTP client with timeout controls.
- Best use cases:
  - Internal services needing a simple typed HTTP+JSON helper.
  - Eliminating repeated timeout/retry/proxy boilerplate.
  - Creating consistent request semantics across modules.
- Use this when:
  - You want one opinionated JSON client surface.
- Avoid this when:
  - You need low-level transport control (use `proxy-undici` or `proxy-agent`).

### `@commandrelay/proxy-runtime` (`packages/proxy-runtime`)

- What it does: runtime controller for settings reloads, route decisions, and agent lifecycle.
- Best use cases:
  - Long-lived processes that need hot reload of proxy settings.
  - Shared central runtime for multiple outgoing HTTP clients.
  - Lifecycle ownership of dispatcher/agent objects.
- Use this when:
  - Proxy policy and agent lifecycle are dynamic at runtime.
- Avoid this when:
  - Static startup-time proxy config is enough.

### `@commandrelay/proxy-undici` (`packages/proxy-undici`)

- What it does: Undici dispatcher factory aware of proxy policy.
- Best use cases:
  - High-performance Node HTTP stacks based on Undici.
  - Creating proxy-aware dispatchers for HTTP/HTTPS.
  - Aligning Undici behavior with shared proxy policy.
- Use this when:
  - You run Undici directly.
- Avoid this when:
  - You use fetch/Axios/Got abstractions.

### `@commandrelay/run-core` (`packages/run-core`)

- What it does: durable run orchestration contracts and shared run types.
- Best use cases:
  - Defining run records/statuses across orchestration layers.
  - Type-safe interchange between orchestrator and runtime consumers.
  - Avoiding contract drift in durable run metadata.
- Use this when:
  - You need shared durable-run type contracts.
- Avoid this when:
  - You need run execution behavior (use `@commandrelay/run-orchestrator`).

### `@commandrelay/run-orchestrator` (`packages/run-orchestrator`)

- What it does: durable local run orchestration over runtime backends.
- Best use cases:
  - Start/list/inspect/reconcile/stop long-running tasks locally.
  - Persisting run ledger state and reconciling with backend panes.
  - Building task-runner UX or automation with durable state.
- Use this when:
  - You need run lifecycle management, not just transient command execution.
- Avoid this when:
  - You only need raw runtime backend calls.

### `@commandrelay/runtime-cmux` (`packages/runtime-cmux`)

- What it does: cmux runtime backend adapter.
- Best use cases:
  - Integrating CommandRelay with cmux-managed terminal surfaces.
  - Standardizing cmux capture/input/list behavior behind runtime interfaces.
  - Supporting environments where cmux is primary multiplexer.
- Use this when:
  - cmux is your runtime backend.
- Avoid this when:
  - You run tmux/managed/ssh backends instead.

### `@commandrelay/runtime-core` (`packages/runtime-core`)

- What it does: runtime contracts, command helpers, and multiplexing primitives.
- Best use cases:
  - Building new runtime adapters with shared command patterns.
  - Applying consistent command execution and line handling.
  - Multiplexing runtime backends behind one interface.
- Use this when:
  - You are implementing backend adapters or runtime abstractions.
- Avoid this when:
  - You only need a specific ready-made backend adapter.

### `@commandrelay/runtime-managed` (`packages/runtime-managed`)

- What it does: managed PTY runtime adapter.
- Best use cases:
  - Owning lifecycle of managed terminal sessions.
  - Running commands where managed daemon semantics are required.
  - Recoverable PTY workflows with adapter-level control.
- Use this when:
  - You need the managed backend (`oly`) as runtime.
- Avoid this when:
  - tmux/cmux/ssh backends already fit your environment.

### `@commandrelay/runtime-ssh` (`packages/runtime-ssh`)

- What it does: SSH-backed runtime adapter (tmux over SSH).
- Best use cases:
  - Remote execution on SSH-reachable hosts.
  - Reusing local runtime abstractions with remote transport.
  - Secure remote pane operations with host-key/fingerprint options.
- Use this when:
  - You need remote runtime control through SSH.
- Avoid this when:
  - All operations are local and low-latency.

### `@commandrelay/runtime-tmux` (`packages/runtime-tmux`)

- What it does: tmux runtime backend adapter.
- Best use cases:
  - Local tmux-backed session lifecycle control.
  - Attaching command execution to tmux panes/windows.
  - Standardized tmux capture/input/list integration.
- Use this when:
  - tmux is your primary local backend.
- Avoid this when:
  - You are using managed, cmux, or remote ssh backends.

### `@commandrelay/terminal-discovery` (`packages/terminal-discovery`)

- What it does: terminal/shell/host discovery primitives.
- Best use cases:
  - Selecting a runtime backend based on host/terminal capabilities.
  - Cross-platform shell/terminal detection in bootstrap logic.
  - Environment-aware defaults for CLI/TUI startup.
- Use this when:
  - You need robust platform/terminal detection before runtime selection.
- Avoid this when:
  - Runtime backend is fixed and preconfigured.

## Category map

- UX/entry points:
  - `@commandrelay/tui`
  - `@commandrelay/cli-proxy`
  - `@commandrelay/client`
  - `@commandrelay/relay-proxy`
- Protocol/contracts:
  - `@commandrelay/protocol`
  - `@commandrelay/run-core`
  - `@commandrelay/runtime-core`
- Proxy ecosystem:
  - `@commandrelay/proxy-core`
  - `@commandrelay/proxy-agent`
  - `@commandrelay/proxy-runtime`
  - `@commandrelay/proxy-http-client`
  - `@commandrelay/proxy-fetch`
  - `@commandrelay/proxy-axios`
  - `@commandrelay/proxy-got`
  - `@commandrelay/proxy-undici`
- Durable run orchestration:
  - `@commandrelay/run-orchestrator`
- Runtime backend adapters:
  - `@commandrelay/runtime-tmux`
  - `@commandrelay/runtime-cmux`
  - `@commandrelay/runtime-managed`
  - `@commandrelay/runtime-ssh`
- Discovery:
  - `@commandrelay/terminal-discovery`

## Decision anti-patterns

- Do not implement proxy env parsing separately in each app. Use `@commandrelay/proxy-core`.
- Do not couple business code directly to multiple HTTP stacks when one adapter package is enough.
- Do not bypass `@commandrelay/protocol` contracts in client/server message handling.
- Do not add ad-hoc runtime abstractions outside `@commandrelay/runtime-core`.
- Do not use TUI as an automation API; use client/libs for automation.
