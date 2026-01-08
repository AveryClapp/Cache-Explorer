// Sequential array access - good cache behavior (C++ version)
// Expected: High hit rate due to spatial locality
// Demonstrates: std::vector, std::array, range-based for loops

#include <iostream>
#include <vector>
#include <array>
#include <numeric>

constexpr size_t N = 1000;

int main() {
  // Using std::vector (heap allocated, like C's malloc)
  std::vector<int> vec(N);

  // Using std::array (stack allocated, like C's int arr[N])
  std::array<int, N> arr{};

  int sum = 0;

  // Sequential writes using range-based for with index
  for (size_t i = 0; i < N; ++i) {
    vec[i] = static_cast<int>(i);
    arr[i] = static_cast<int>(i);
  }

  // Sequential reads - should hit cache
  // std::accumulate demonstrates sequential access pattern
  sum = std::accumulate(vec.begin(), vec.end(), 0);
  sum += std::accumulate(arr.begin(), arr.end(), 0);

  std::cout << "Sum: " << sum << '\n';
  return 0;
}
