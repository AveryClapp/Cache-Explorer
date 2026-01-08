// False sharing demonstration (C++ version)
// Expected: Cache invalidations when threads modify adjacent data
// Demonstrates: std::thread, std::atomic, cache line padding

#include <iostream>
#include <thread>
#include <atomic>
#include <vector>
#include <chrono>

constexpr size_t CACHE_LINE_SIZE = 64;
constexpr size_t NUM_THREADS = 4;
constexpr size_t ITERATIONS = 100000;

// Bad: counters packed together, will cause false sharing
struct PackedCounters {
  std::atomic<int> counters[NUM_THREADS];
};

// Good: counters padded to separate cache lines
struct alignas(CACHE_LINE_SIZE) PaddedCounter {
  std::atomic<int> value{0};
  char padding[CACHE_LINE_SIZE - sizeof(std::atomic<int>)];
};

struct PaddedCounters {
  PaddedCounter counters[NUM_THREADS];
};

template<typename Counters>
void increment_counter(Counters& c, size_t thread_id) {
  for (size_t i = 0; i < ITERATIONS; ++i) {
    if constexpr (std::is_same_v<Counters, PackedCounters>) {
      c.counters[thread_id].fetch_add(1, std::memory_order_relaxed);
    } else {
      c.counters[thread_id].value.fetch_add(1, std::memory_order_relaxed);
    }
  }
}

template<typename Counters>
void run_test(const char* name, Counters& counters) {
  std::vector<std::thread> threads;

  auto start = std::chrono::high_resolution_clock::now();

  for (size_t i = 0; i < NUM_THREADS; ++i) {
    threads.emplace_back(increment_counter<Counters>, std::ref(counters), i);
  }

  for (auto& t : threads) {
    t.join();
  }

  auto end = std::chrono::high_resolution_clock::now();
  auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end - start);

  std::cout << name << ": " << duration.count() << " us\n";
}

int main() {
  PackedCounters packed{};
  PaddedCounters padded{};

  std::cout << "False Sharing Demonstration\n";
  std::cout << "Cache line size: " << CACHE_LINE_SIZE << " bytes\n";
  std::cout << "Threads: " << NUM_THREADS << "\n";
  std::cout << "Iterations per thread: " << ITERATIONS << "\n\n";

  run_test("Packed (false sharing)", packed);
  run_test("Padded (no false sharing)", padded);

  return 0;
}
