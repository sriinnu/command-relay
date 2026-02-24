# Security

CommandRelay assumes remote access is sensitive and applies strict defaults.

## Security Objectives

1. Prevent unauthorized session access.
2. Prevent silent remote command execution.
3. Preserve auditability of all control actions.
4. Limit blast radius of misconfiguration.

## Baseline Controls

1. Read-only default for every new connection.
2. Explicit input enable action required.
3. Authenticated and authorized session access.
4. Audit logs for auth, attach, input, and admin actions.
5. Session-level and user-level rate limits.
6. Maximum payload size checks.

## Network Controls

1. Prefer private mesh (Tailscale/WireGuard).
2. Do not expose unauthenticated public endpoints.
3. Bind gateway to private interface where possible.

## Sensitive Operation Controls

1. Global input kill switch.
2. Per-session input freeze.
3. Optional command policy filters.

## Incident Readiness

1. Keep logs with timestamp, actor, target pane, and action result.
2. Add admin endpoint to revoke sessions quickly.
3. Document key rotation and token revocation process.
