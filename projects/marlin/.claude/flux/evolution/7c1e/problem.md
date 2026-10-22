# Evolution 7c1e

## Problem

Isochrone engine for Stockholm public transport. Given an origin (lat/lon), a start
time and user settings (max travel time up to 120 min, max wait time, walking speed
and limits, allowed modes, max transfers), return reachable areas as 5-minute colour
bands, rendered on the frontend map. Must answer in a couple of seconds and must never
call Trafiklab per request: everything comes from preprocessed GTFS artifacts produced
by vijay-team.

## Context detection

Signals:
- "within a couple of seconds", 120 min horizon, whole SL network -> PERFORMANCE-CRITICAL
- static preprocessed data, read-only, no user data -> NOT security-critical
- served to another team's frontend over a fixed contract -> INTEGRATION-SENSITIVE

Applied context: PERFORMANCE-CRITICAL + INTEGRATION-SENSITIVE

Graveyard filters: graveyard is empty, no gene is blocked yet.
Encouraged in this context: analytical, methodical, testing (correctness of a routing
algorithm is invisible without tests), api-design (contract is consumed by two teams).
Guarded: experimental > 0.6 requires testing >= 0.4.

## Timelines

- alpha: RAPTOR, round-based. One round per transfer, so max-connections is a native
  stopping condition.
- beta: CSA (Connection Scan Algorithm) over one globally sorted connection array.
- gamma: Precomputed time-expanded graph plus Dijkstra, with per-origin caching of
  nearby stop sets.

## Fitness criteria for this problem

- correctness of arrival times against hand-checked journeys (weight: high)
- query latency at 120 min horizon (weight: high)
- memory footprint when loading the SL network
- how cleanly the settings (modes, max wait, max transfers, walking) map onto the algorithm
- quality of the polygon/band output for the frontend
