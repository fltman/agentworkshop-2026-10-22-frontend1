# Timeline-gamma — TERMINATED at gen-001

Evolution: 7c1e "isochrone engine for SL"
Context: PERFORMANCE-CRITICAL + INTEGRATION-SENSITIVE
Fitness: 22 (threshold 20; terminated on uselessness, not on failure)

## Approach

Precompute a time-expanded graph (node = stop at a time event), run Dijkstra from the
origin's nearby stops, cache per origin cell.

## Why it died

The risk written down at spawn is exactly what killed it: **the user's settings change
the graph itself.** Allowed modes, maximum wait and maximum transfers are not filters on
top of a precomputed structure, they are part of its edge set. So either the graph is
rebuilt per request, which is slower than just scanning, or the cache key has to contain
every setting, at which point the cache is no longer "per origin" and the hit rate
collapses to "the same user pressed Update twice".

The time-expanded graph for a full SL service day is also the largest structure of the
three, for the worst query latency of the three. In a PERFORMANCE-CRITICAL context that
is a double loss.

## What survives

One gene, and it is a good one: **key the cache on the whole query, not on the origin.**
That is now the 40-entry LRU in `board/plugins/marlin/index.js`, and it is the reason a
user dragging a slider back and forth gets an instant answer. The idea was right; the
structure it was attached to was wrong.

## Contextual risk profile

```
experimental: 0.5 + creative: 0.6
  NEUTRAL here. The experiment was cheap and it answered a real question.
  The gene is not toxic; the hypothesis was.

precompute-everything (approach gene)
  LETHAL in: contexts where user settings are part of the graph.
  BENEFICIAL in: fixed-parameter queries (one mode set, one time of day),
                 e.g. a static "15-minute city" map with no controls.
  Do not resurrect for an interactive tool. Do resurrect for a batch job.
```

That last line is the point of keeping this file. The gene is not banned; it is banned
*here*.
