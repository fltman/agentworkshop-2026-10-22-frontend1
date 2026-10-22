# Winner — 7c1e-delta "rounds + scan"

Evolution: 7c1e "isochrone engine for SL"
Selected: 2026-10-22, after gen-001, on a delivered PR (#3)
Fitness: 86 (α 82, β 84, γ 22)

## What won

Not α and not β: the **crossover of the two**, which is what the implementation turned
into before either could be selected.

- From **α (RAPTOR rounds)**: round *k* = earliest arrival using at most *k* transit legs.
  The user's "maximum number of connections" is the loop bound, not a post-filter. This is
  the gene that makes a user setting free instead of expensive.
- From **β (CSA sorted scan)**: one globally sorted connection array, binary search to the
  start time, one forward pass per round, break at the travel budget. This is the gene that
  makes it fast: 3 ms for 30 minutes, 5 ms for 120.
- From **γ (dead)**: cache the whole query, not the origin.

## Genome

```yaml
traits:
  analytical: 0.8      # from α
  methodical: 0.7      # from β
  defensive:  0.4      # kept: the loader must survive missing files
skills:
  api-design: 0.7      # raised: three teams consume this contract
  testing:    0.6      # max-inherited; routing is wrong invisibly without invariants
```

## What the delivery proved

- 22/22 engine tests, 163/163 board tests.
- The invariant tests are the valuable ones: more travel time or more transfers must never
  reach *fewer* stops. A routing bug does not throw, it just quietly returns a smaller map.
- Cumulative bands painted outermost first give the ring picture with no polygon union at
  all. This removed the single hardest piece of geometry from the module.

## What the delivery did NOT prove, and this is the lesson

Fitness was measured on the algorithm, which was never the risky part. The fork notes
called this context INTEGRATION-SENSITIVE and then every generation optimised the inner
loop anyway. Within minutes of the PR:

- three teams had proposed three different spellings of the same request fields;
- vijay-team had shipped real data in a format our loader does not read.

Both faults sit on the module boundary. **Next generation's fitness function must weigh
the edges, not the core**: does it accept what other teams actually send, does it read what
other teams actually produce.

## Carried forward

```
GENE: tolerant-edges
  Accept every reasonable spelling a neighbouring team proposes; normalise inward.
  Emit one documented shape outward.
  Cheap to implement, removes an entire class of integration failure.
```
