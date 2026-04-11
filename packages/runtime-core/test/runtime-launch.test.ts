import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeShellInvocation } from "../src/index.js";

test("buildRuntimeShellInvocation normalizes posix shells", () => {
  const invocation = buildRuntimeShellInvocation("npm test", "/bin/bash");
  assert.deepEqual(invocation, {
    command: "/bin/bash",
    args: ["-lc", "npm test"],
    shellFamily: "posix"
  });
});

test("buildRuntimeShellInvocation normalizes cmd shells", () => {
  const invocation = buildRuntimeShellInvocation("dir", "cmd.exe");
  assert.deepEqual(invocation, {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "dir"],
    shellFamily: "cmd"
  });
});

test("buildRuntimeShellInvocation normalizes powershell shells", () => {
  const invocation = buildRuntimeShellInvocation("Get-ChildItem", "pwsh.exe");
  assert.deepEqual(invocation, {
    command: "pwsh.exe",
    args: ["-NoLogo", "-Command", "Get-ChildItem"],
    shellFamily: "powershell"
  });
});
