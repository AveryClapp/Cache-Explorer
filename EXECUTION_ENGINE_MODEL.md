# Execution Engine Model

Cache Explorer's execution-engine stats are estimates. They are meant to show
which hardware subsystem is likely limiting a run, not to predict exact
wall-clock runtime.

## What Is Modeled

- Conditional branch prediction with a bimodal 2-bit saturating-counter model.
- Branch misprediction penalties as fixed front-end refill cycles.
- Instruction fetch pressure from I-cache misses.
- A first-order out-of-order pipeline estimate with issue width and ROB size.
- Data miss stalls after subtracting latency that the out-of-order window can
  hide.

## What Is Not Modeled

- Cycle-accurate scheduling, reorder-buffer contents, or Tomasulo-style issue.
- Per-instruction dependency graphs.
- Execution ports, uop fusion, decode width, register renaming, or exact vendor
  branch predictors.
- SMT, OS scheduling, turbo, thermal behavior, interrupts, or real elapsed time.

## How To Read It

The `execution` JSON object has two major sections:

- `pipeline`: estimated instructions, cycles, IPC/CPI, and stall-cycle buckets.
- `branchPrediction`: total branches, mispredictions, accuracy, and the source
  lines with the most mispredictions.

The most useful question is:

> Which bucket dominates: front-end, memory, or branch stalls?

If memory stalls dominate, look at cache/TLB hot lines. If branch stalls
dominate, inspect the hot branch source lines. If front-end stalls dominate,
look for code layout or instruction-cache pressure.

## Current Limits

Execution stats are available for single-core detailed simulation. They are
reported as unavailable for multi-core and segment-cached runs until those paths
can preserve branch/pipeline deltas correctly.
