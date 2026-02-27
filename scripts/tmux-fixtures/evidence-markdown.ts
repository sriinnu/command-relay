import type { CheckpointMarkdownInput } from "./evidence-types.js";

/**
 * Builds the checkpoint markdown artifact for a fixture evidence run.
 */
export function buildCheckpointMarkdown(input: CheckpointMarkdownInput): string {
  const {
    checkpointDate,
    checkpointPath,
    options,
    commandResults,
    paneCaptures,
    assertionResults,
    overallPassed,
    failureSummary
  } = input;
  const capturedUtc = new Date().toISOString();

  const commandRows = [
    ["create-fixture", commandResults.create],
    ["emit-fixture-output", commandResults.emit],
    ["teardown-fixture", commandResults.teardown]
  ]
    .map(([name, result]) => {
      if (!result) {
        return `| ${name} | not-run | - | - |`;
      }
      return `| ${name} | ${result.success ? "pass" : "fail"} | ${result.durationMs} | \`${escapeInline(result.command)} ${result.args.map(escapeInline).join(" ")}\` |`;
    })
    .join("\n");

  const paneRows =
    paneCaptures.length === 0
      ? "| none | none | none |\n"
      : paneCaptures
          .map((capture) => `| ${capture.paneIndex} | ${capture.paneId} | ${capture.fixtureEventCount} |`)
          .join("\n");

  const assertionRows =
    assertionResults.length === 0
      ? "| no assertions | fail | harness aborted before assertions |\n"
      : assertionResults
          .map((result) => `| ${result.name} | ${result.passed ? "pass" : "fail"} | ${result.detail} |`)
          .join("\n");

  const failureBlock = failureSummary ? `\n## Failure Summary\n\n- ${failureSummary}\n` : "";

  return `# A2 tmux Fixture Harness Evidence - ${checkpointDate}

- Captured (UTC): ${capturedUtc}
- Status: \`${overallPassed ? "pass" : "fail"}\`
- Artifact path: \`${checkpointPath}\`

## Command

\`node --import tsx scripts/tmux-fixtures/run-fixture-evidence.ts --session ${options.session} --window ${options.window} --panes ${options.panes} --profile ${options.profile} --cycles ${options.cycles} --lines-per-cycle ${options.linesPerCycle} --delay-ms ${options.delayMs}${options.keepFixture ? " --keep-fixture" : ""}\`

## Command Stages

| Stage | Status | Duration (ms) | Invocation |
| --- | --- | --- | --- |
${commandRows}

## Pane Capture Summary

| Pane Index | Pane ID | Fixture Events Captured |
| --- | --- | --- |
${paneRows}

## Replay Ordering Assertions

| Assertion | Status | Detail |
| --- | --- | --- |
${assertionRows}
${failureBlock}
## Operator Notes

- This evidence run is deterministic when tmux availability and fixture scripts are unchanged.
- The harness is idempotent for the same session name because it force-recreates only marked fixture sessions.
`;
}

function escapeInline(value: string): string {
  return value.replaceAll("`", "\\`");
}
