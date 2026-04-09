import type {
  AssertionResult,
  FixtureEvent,
  Options,
  PaneRow
} from "./evidence-types.js";

/**
 * Builds a typed assertion result record.
 */
export function buildAssertion(name: string, passed: boolean, detail: string): AssertionResult {
  return { name, passed, detail };
}

/**
 * Validates global sequence continuity and replay ordering for captured events.
 */
export function assertOrdering(
  capturedEvents: FixtureEvent[],
  paneRows: PaneRow[],
  options: Options
): AssertionResult[] {
  const assertions: AssertionResult[] = [];
  const sortedBySeq = [...capturedEvents].sort((left, right) => left.seq - right.seq);
  const expected: Array<Pick<FixtureEvent, "seq" | "pane" | "cycle" | "line">> = [];

  let expectedSeq = 1;
  for (let cycle = 1; cycle <= options.cycles; cycle += 1) {
    for (let line = 1; line <= options.linesPerCycle; line += 1) {
      for (const paneRow of paneRows) {
        expected.push({
          seq: expectedSeq,
          pane: paneRow.paneIndex,
          cycle,
          line
        });
        expectedSeq += 1;
      }
    }
  }

  const sequenceIsContinuous = sortedBySeq.every((event, index) => event.seq === index + 1);
  assertions.push(
    buildAssertion(
      "global_sequence_continuous",
      sequenceIsContinuous,
      sequenceIsContinuous
        ? `validated ${sortedBySeq.length} events`
        : `expected seq ${findFirstSequenceGap(sortedBySeq)} at first mismatch`
    )
  );

  let mismatchDetail = "all events matched expected replay ordering";
  let matchesExpectedOrder = sortedBySeq.length === expected.length;
  if (matchesExpectedOrder) {
    for (let index = 0; index < expected.length; index += 1) {
      const actualEvent = sortedBySeq[index];
      const expectedEvent = expected[index];
      if (
        actualEvent.seq !== expectedEvent.seq ||
        actualEvent.pane !== expectedEvent.pane ||
        actualEvent.cycle !== expectedEvent.cycle ||
        actualEvent.line !== expectedEvent.line
      ) {
        matchesExpectedOrder = false;
        mismatchDetail = `seq=${expectedEvent.seq} expected pane=${expectedEvent.pane} cycle=${expectedEvent.cycle} line=${expectedEvent.line}, actual pane=${actualEvent.pane} cycle=${actualEvent.cycle} line=${actualEvent.line}`;
        break;
      }
    }
  } else {
    mismatchDetail = `expected ${expected.length} ordered events, actual ${sortedBySeq.length}`;
  }

  assertions.push(buildAssertion("replay_order_matches_emit_schedule", matchesExpectedOrder, mismatchDetail));
  return assertions;
}

function findFirstSequenceGap(events: FixtureEvent[]): number {
  for (let index = 0; index < events.length; index += 1) {
    const expectedSeq = index + 1;
    if (events[index].seq !== expectedSeq) {
      return expectedSeq;
    }
  }
  return events.length + 1;
}
