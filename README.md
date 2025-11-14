# Cache Explorer

A tool for visualizing how code interacts with CPU cache hierarchies.

## What it does

Cache Explorer simulates memory access patterns and shows you what's happening in L1, L2, and L3 caches as your code runs. Paste in some C/C++ code with loops and data structures, and see which accesses hit or miss at each cache level.

## Why this exists

Understanding cache behavior usually requires either reading performance counter output or just guessing. This tool sits in between - it's not as precise as hardware counters, but it's visual and immediate.

Useful for:
- Learning about cache hierarchies and memory access patterns
- Understanding why certain code optimizations help (or don't)
- Debugging performance issues related to cache misses
- Teaching systems programming concepts

## What it's not

This is a simulator, not a profiler. It models cache behavior based on architecture parameters, but won't catch every hardware detail. For production performance analysis, use proper profiling tools.

## Tech

- Simulates configurable cache hierarchies (sizes, associativity, line sizes)
- Steps through code execution and tracks memory accesses
- Visualizes cache state over time

---

Built to make cache behavior less mysterious.
