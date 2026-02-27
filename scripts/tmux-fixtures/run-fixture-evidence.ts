import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertOrdering, buildAssertion } from "./evidence-assertions.js";
import { parseArgs, resolveCheckpointPath, USAGE } from "./evidence-cli.js";
import {
  capturePane,
  listPanes,
  runFixtureScript
} from "./evidence-commands.js";
import { buildCheckpointMarkdown } from "./evidence-markdown.js";
import type {
  AssertionResult,
  CommandResults,
  PaneCapture
} from "./evidence-types.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const CHECKPOINT_RUNS_DIR = path.join(PROJECT_ROOT, "scripts", "checkpoints", "runs");

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const checkpointPath = resolveCheckpointPath(options.outputPath, CHECKPOINT_RUNS_DIR);
  const checkpointDate = new Date().toISOString().slice(0, 10);
  const expectedTotalEvents = options.panes * options.cycles * options.linesPerCycle;
  const assertionResults: AssertionResult[] = [];
  const commandResults: CommandResults = {};
  const paneCaptures: PaneCapture[] = [];

  let overallPassed = true;
  let failureSummary = "";
  let createdFixture = false;

  try {
    commandResults.create = await runFixtureScript(SCRIPT_DIR, PROJECT_ROOT, "create-fixture.sh", [
      "--session",
      options.session,
      "--window",
      options.window,
      "--panes",
      String(options.panes),
      "--force-recreate"
    ]);
    createdFixture = true;

    commandResults.emit = await runFixtureScript(SCRIPT_DIR, PROJECT_ROOT, "emit-fixture-output.sh", [
      "--session",
      options.session,
      "--window",
      options.window,
      "--profile",
      options.profile,
      "--cycles",
      String(options.cycles),
      "--lines-per-cycle",
      String(options.linesPerCycle),
      "--delay-ms",
      String(options.delayMs)
    ]);

    const paneRows = await listPanes(PROJECT_ROOT, options.session, options.window);
    assertionResults.push(
      buildAssertion(
        "pane_count_matches_expected",
        paneRows.length === options.panes,
        `expected ${options.panes}, actual ${paneRows.length}`
      )
    );

    for (const paneRow of paneRows) {
      const capture = await capturePane(PROJECT_ROOT, paneRow, options.profile);
      paneCaptures.push(capture);
    }

    const capturedEvents = paneCaptures.flatMap((capture) => capture.events);
    assertionResults.push(
      buildAssertion(
        "total_event_count",
        capturedEvents.length === expectedTotalEvents,
        `expected ${expectedTotalEvents}, actual ${capturedEvents.length}`
      )
    );

    for (const capture of paneCaptures) {
      const expectedPerPane = options.cycles * options.linesPerCycle;
      assertionResults.push(
        buildAssertion(
          `pane_${capture.paneIndex}_event_count`,
          capture.fixtureEventCount === expectedPerPane,
          `expected ${expectedPerPane}, actual ${capture.fixtureEventCount}`
        )
      );
    }

    assertionResults.push(...assertOrdering(capturedEvents, paneRows, options));
  } catch (error) {
    overallPassed = false;
    failureSummary = error instanceof Error ? error.message : String(error);
  } finally {
    if (createdFixture && !options.keepFixture) {
      try {
        commandResults.teardown = await runFixtureScript(SCRIPT_DIR, PROJECT_ROOT, "teardown-fixture.sh", [
          "--session",
          options.session,
          "--if-missing-ok"
        ]);
      } catch (error) {
        overallPassed = false;
        const teardownError = error instanceof Error ? error.message : String(error);
        failureSummary = failureSummary
          ? `${failureSummary}; teardown failed: ${teardownError}`
          : `teardown failed: ${teardownError}`;
      }
    }
  }

  if (assertionResults.some((result) => !result.passed)) {
    overallPassed = false;
    const firstFailure = assertionResults.find((result) => !result.passed);
    if (firstFailure && !failureSummary) {
      failureSummary = `${firstFailure.name}: ${firstFailure.detail}`;
    }
  }

  const markdown = buildCheckpointMarkdown({
    checkpointDate,
    checkpointPath,
    options,
    commandResults,
    paneCaptures,
    assertionResults,
    overallPassed,
    failureSummary
  });

  await mkdir(path.dirname(checkpointPath), { recursive: true });
  await writeFile(checkpointPath, markdown, "utf8");

  process.stdout.write(`fixture_evidence_status=${overallPassed ? "pass" : "fail"}\n`);
  process.stdout.write(`fixture_evidence_artifact=${checkpointPath}\n`);

  if (!overallPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(
    `run-fixture-evidence error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
