# Cache Explorer Examples

A collection of C and C++ programs demonstrating various cache access patterns and optimization techniques.

## Basic Patterns

| Example | C | C++ | Description | Expected Behavior |
|---------|---|-----|-------------|-------------------|
| Sequential | `sequential.c` | `sequential.cpp` | Linear array traversal | Excellent L1 hit rate (99%+) |
| Strided | `strided.c` | - | Access every Nth element | Moderate hit rate, depends on stride |
| Matrix Row | `matrix_row.c` | `matrix_row.cpp` | Row-major matrix access | Good cache utilization |
| Matrix Col | `matrix_col.c` | `matrix_col.cpp` | Column-major matrix access | Poor cache utilization |

## Data Structures

| Example | C | C++ | Description | Expected Behavior |
|---------|---|-----|-------------|-------------------|
| Linked List | `linked_list.c` | `linked_list.cpp` | Pointer chasing traversal | Poor locality, many misses |
| Hash Table | `hash_table.c` | - | Hash-based lookups | Random access pattern |
| Binary Search | `binary_search.c` | - | Binary search algorithm | Unpredictable access |
| Memory Pool | `memory_pool.c` | - | Pool vs malloc allocation | Pool has better locality |

## Optimization Patterns

| Example | C | C++ | Description | Cache Benefit |
|---------|---|-----|-------------|---------------|
| Array of Structs | `array_of_structs.c` | - | AoS layout | Loads unused fields |
| Struct of Arrays | `struct_of_arrays.c` | `struct_of_arrays.cpp` | SoA layout | Perfect for single-field access |
| Cache Blocking | `cache_blocking.c` | `cache_blocking.cpp` | Tiled matrix multiply | Keeps tiles in L1 |
| Loop Interchange | `loop_interchange.c` | - | Row vs column loop order | Row-major is cache-friendly |
| Loop Fusion | `loop_fusion.c` | - | Combining multiple loops | Reduces cache traffic |
| Cache Line Align | `cache_line_align.c` | - | Aligned data structures | Avoids split accesses |

## Working Set Size

| Example | C | C++ | Description | Expected Behavior |
|---------|---|-----|-------------|-------------------|
| Working Set Small | `working_set_small.c` | - | 16KB dataset | Fits in L1, high hit rate |
| Working Set Large | `working_set_large.c` | - | 64MB dataset | Exceeds L3, many misses |

## Prefetching

| Example | C | C++ | Description | Expected Behavior |
|---------|---|-----|-------------|-------------------|
| Prefetch Friendly | `prefetch_friendly.c` | - | Sequential access | Prefetcher works well |
| Prefetch Unfriendly | `prefetch_unfriendly.c` | - | Random access | Prefetcher cannot help |

## Multi-threading

| Example | C | C++ | Description | Expected Behavior |
|---------|---|-----|-------------|-------------------|
| False Sharing | `false_sharing.c` | `false_sharing.cpp` | Adjacent data updates | Cache line ping-pong |

## Real-World Patterns

| Example | C | C++ | Description | Pattern Type |
|---------|---|-----|-------------|--------------|
| Image Blur | `image_blur.c` | - | 3x3 box blur | 2D stencil access |
| String Search | `string_search.c` | - | Substring search | Sequential scan |
| Quicksort | `quicksort.c` | `quicksort.cpp` | Divide and conquer sort | Recursive partitioning |

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
