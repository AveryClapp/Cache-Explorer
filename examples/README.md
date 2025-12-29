# Cache Explorer Examples

A collection of programs demonstrating various cache access patterns and optimization techniques.

## Basic Patterns

| Example | Description | Expected Behavior |
|---------|-------------|-------------------|
| `sequential.c` | Linear array traversal | Excellent L1 hit rate (99%+) |
| `strided.c` | Access every Nth element | Moderate hit rate, depends on stride |
| `matrix_row.c` | Row-major matrix access | Good cache utilization |
| `matrix_col.c` | Column-major matrix access | Poor cache utilization |

## Data Structures

| Example | Description | Expected Behavior |
|---------|-------------|-------------------|
| `linked_list.c` | Pointer chasing traversal | Poor locality, many misses |
| `hash_table.c` | Hash-based lookups | Random access pattern |
| `binary_search.c` | Binary search algorithm | Unpredictable access |
| `memory_pool.c` | Pool vs malloc allocation | Pool has better locality |

## Optimization Patterns

| Example | Description | Cache Benefit |
|---------|-------------|---------------|
| `array_of_structs.c` | AoS layout | Loads unused fields |
| `struct_of_arrays.c` | SoA layout | Perfect for single-field access |
| `cache_blocking.c` | Tiled matrix multiply | Keeps tiles in L1 |
| `loop_interchange.c` | Row vs column loop order | Row-major is cache-friendly |
| `loop_fusion.c` | Combining multiple loops | Reduces cache traffic |
| `cache_line_align.c` | Aligned data structures | Avoids split accesses |

## Working Set Size

| Example | Description | Expected Behavior |
|---------|-------------|-------------------|
| `working_set_small.c` | 16KB dataset | Fits in L1, high hit rate |
| `working_set_large.c` | 64MB dataset | Exceeds L3, many misses |

## Prefetching

| Example | Description | Expected Behavior |
|---------|-------------|-------------------|
| `prefetch_friendly.c` | Sequential access | Prefetcher works well |
| `prefetch_unfriendly.c` | Random access | Prefetcher cannot help |

## Multi-threading

| Example | Description | Expected Behavior |
|---------|-------------|-------------------|
| `false_sharing.c` | Adjacent data updates | Cache line ping-pong |

## Real-World Patterns

| Example | Description | Pattern Type |
|---------|-------------|--------------|
| `image_blur.c` | 3x3 box blur | 2D stencil access |
| `string_search.c` | Substring search | Sequential scan |
| `quicksort.c` | Divide and conquer sort | Recursive partitioning |

## How to Use

Run any example with Cache Explorer:

```bash
# Basic analysis
./backend/scripts/cache-explore examples/sequential.c

# Compare configurations
./backend/scripts/cache-explore examples/matrix_row.c --config intel
./backend/scripts/cache-explore examples/matrix_col.c --config intel

# With optimization
./backend/scripts/cache-explore examples/cache_blocking.c -O2

# Generate HTML report
./backend/scripts/cache-explore-report examples/linked_list.c
```

## Suggested Comparisons

1. **Row vs Column Major**
   ```bash
   ./backend/scripts/cache-explore examples/matrix_row.c
   ./backend/scripts/cache-explore examples/matrix_col.c
   ```

2. **AoS vs SoA**
   ```bash
   ./backend/scripts/cache-explore examples/array_of_structs.c
   ./backend/scripts/cache-explore examples/struct_of_arrays.c
   ```

3. **Sequential vs Random**
   ```bash
   ./backend/scripts/cache-explore examples/prefetch_friendly.c
   ./backend/scripts/cache-explore examples/prefetch_unfriendly.c
   ```

4. **Working Set Size**
   ```bash
   ./backend/scripts/cache-explore examples/working_set_small.c
   ./backend/scripts/cache-explore examples/working_set_large.c
   ```
