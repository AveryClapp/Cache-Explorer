// False sharing demonstration (Rust version)
// Expected: Cache invalidations when threads modify adjacent data
// Demonstrates: std::thread, AtomicUsize, cache line padding

use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::Instant;

const CACHE_LINE_SIZE: usize = 64;
const NUM_THREADS: usize = 4;
const ITERATIONS: usize = 100000;

// Bad: counters packed together, will cause false sharing
struct PackedCounters {
    counters: [AtomicUsize; NUM_THREADS],
}

impl PackedCounters {
    fn new() -> Self {
        Self {
            counters: std::array::from_fn(|_| AtomicUsize::new(0)),
        }
    }
}

// Good: counters padded to separate cache lines
#[repr(C, align(64))]
struct PaddedCounter {
    value: AtomicUsize,
    _padding: [u8; CACHE_LINE_SIZE - std::mem::size_of::<AtomicUsize>()],
}

impl PaddedCounter {
    fn new() -> Self {
        Self {
            value: AtomicUsize::new(0),
            _padding: [0; CACHE_LINE_SIZE - std::mem::size_of::<AtomicUsize>()],
        }
    }
}

struct PaddedCounters {
    counters: [PaddedCounter; NUM_THREADS],
}

impl PaddedCounters {
    fn new() -> Self {
        Self {
            counters: std::array::from_fn(|_| PaddedCounter::new()),
        }
    }
}

fn run_packed_test(counters: &PackedCounters) {
    let start = Instant::now();

    thread::scope(|s| {
        for i in 0..NUM_THREADS {
            s.spawn(move || {
                for _ in 0..ITERATIONS {
                    counters.counters[i].fetch_add(1, Ordering::Relaxed);
                }
            });
        }
    });

    let duration = start.elapsed();
    println!("Packed (false sharing): {:?}", duration);
}

fn run_padded_test(counters: &PaddedCounters) {
    let start = Instant::now();

    thread::scope(|s| {
        for i in 0..NUM_THREADS {
            s.spawn(move || {
                for _ in 0..ITERATIONS {
                    counters.counters[i].value.fetch_add(1, Ordering::Relaxed);
                }
            });
        }
    });

    let duration = start.elapsed();
    println!("Padded (no false sharing): {:?}", duration);
}

fn main() {
    println!("False Sharing Demonstration (Rust)");
    println!("Cache line size: {} bytes", CACHE_LINE_SIZE);
    println!("Threads: {}", NUM_THREADS);
    println!("Iterations per thread: {}", ITERATIONS);
    println!();

    let packed = PackedCounters::new();
    let padded = PaddedCounters::new();

    run_packed_test(&packed);
    run_padded_test(&padded);
}
