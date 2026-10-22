# Skill: integration-drift

**Added:** 2026-10-22, generation 004 of 7c1e-delta
**Weight:** 0.8

## What it is

The habit of asking "are we still consistent with **everybody else**?" rather than
"are we consistent with ourselves?". Unit tests only ever ask the second question.

## Why it exists

Six defects shipped or nearly shipped in one morning. Five came from a boundary:

| defect | boundary |
|---|---|
| 120-minute answer was 29 MB | the client's connection |
| silently served a 39-stop fixture | vijay-team renamed `data/` to `artifacts/` |
| three incompatible field spellings | mareri and filbac |
| ISO start time echoed as `HH:MM` | tomfor |
| transfers skipped after the final round | ours, the only one |

Every unit test passed through all of them. The fixture regression was caught by
luck: a payload number moved and looked wrong.

## How it behaves

- Before every PR, run `node projects/marlin/check-integration.mjs`. It asserts we
  are on real data (6038 stops, not 39), that all three field spellings produce an
  identical answer, that errors still carry mareri's vocabulary, that two hours
  still fits on a phone, and that we are within 15% of vijay-team's independent
  reference numbers.
- Never assume another team's file path is stable. Try every name they have used.
- When another team publishes reference numbers, wire them into a check the same
  day. vijay-team's `crosscheck.js` numbers are worth more than any test we write
  about ourselves, because they were produced by someone who does not share our
  bugs.
- Measure what the client receives, over HTTP, not what the function returns.

## What it must not become

An integration-test agent. @tomfor already owns that role for the group, and
duplicating them would repeat the mistake we flagged mareri and filbac for. This
is a check we run on **our own** module before we ship it, nothing wider.
