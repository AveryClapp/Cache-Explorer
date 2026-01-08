// Quicksort - mixed cache behavior (C++ version)
// Expected: Good locality for partitioning, variable for recursive calls
// Demonstrates: std::span, modern C++ algorithms, cache-aware sorting

#include <iostream>
#include <vector>
#include <algorithm>
#include <random>
#include <span>

constexpr size_t N = 1000;

// Partition using Hoare scheme
// Good cache behavior: two pointers move toward each other
template<typename T>
size_t partition(std::span<T> arr) {
  T pivot = arr[arr.size() / 2];
  size_t i = 0;
  size_t j = arr.size() - 1;

  while (true) {
    while (arr[i] < pivot) ++i;
    while (arr[j] > pivot) --j;
    if (i >= j) return j;
    std::swap(arr[i], arr[j]);
    ++i;
    --j;
  }
}

// Recursive quicksort
template<typename T>
void quicksort(std::span<T> arr) {
  if (arr.size() <= 1) return;

  size_t p = partition(arr);
  quicksort(arr.subspan(0, p + 1));
  quicksort(arr.subspan(p + 1));
}

// Insertion sort for small arrays - better cache behavior
template<typename T>
void insertion_sort(std::span<T> arr) {
  for (size_t i = 1; i < arr.size(); ++i) {
    T key = arr[i];
    size_t j = i;
    while (j > 0 && arr[j - 1] > key) {
      arr[j] = arr[j - 1];
      --j;
    }
    arr[j] = key;
  }
}

// Hybrid quicksort: switch to insertion sort for small subarrays
constexpr size_t INSERTION_THRESHOLD = 16;

template<typename T>
void hybrid_quicksort(std::span<T> arr) {
  if (arr.size() <= INSERTION_THRESHOLD) {
    insertion_sort(arr);
    return;
  }

  size_t p = partition(arr);
  hybrid_quicksort(arr.subspan(0, p + 1));
  hybrid_quicksort(arr.subspan(p + 1));
}

int main() {
  std::vector<int> data(N);

  // Fill with random data
  std::random_device rd;
  std::mt19937 gen(rd());
  std::uniform_int_distribution<int> dist(0, 10000);

  for (auto& v : data) {
    v = dist(gen);
  }

  // Sort using hybrid quicksort (cache-friendly for small arrays)
  hybrid_quicksort(std::span{data});

  // Verify sorted
  bool sorted = std::is_sorted(data.begin(), data.end());
  std::cout << "Sorted: " << (sorted ? "yes" : "no") << '\n';
  std::cout << "First: " << data.front() << ", Last: " << data.back() << '\n';

  return 0;
}
