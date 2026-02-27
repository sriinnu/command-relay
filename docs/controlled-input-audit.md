# Controlled Input Audit Contract

This document defines the structured audit metadata emitted for controlled input operations.

## Event Shape

1. Each record is JSONL with top-level fields: `ts`, `action`, `clientId`, `details`.
2. `ts` is epoch milliseconds assigned by the bridge process.

## Actions

1. `enable_input`:
   - `details.result`: `allowed` or `denied`
   - `details.reason`: `client_enabled` or `global_input_kill_switch`
2. `disable_input`:
   - `details.result`: `allowed`
   - `details.reason`: `client_disabled`
3. `input`:
   - success: `details.result=allowed`, `details.reason=ok`
   - policy/rate/ownership denial: `details.result=denied`, `details.reason` in:
     - `policy_blocked`
     - `rate_limited`
     - `ownership_conflict`
   - shared metadata: `details.paneId`, `details.bytes`
4. `input_takeover`:
   - emitted when override path is used and lane ownership changes
   - includes `details.paneId`, `details.bytes`, `details.result=allowed`, `details.reason=override`

## Sanitization

1. Raw command payload text is never persisted in `details`.
2. Metadata-only capture is enforced (`paneId`, byte count, result, reason).
