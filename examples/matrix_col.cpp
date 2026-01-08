// Column-major matrix traversal - poor cache behavior (C++ version)
// Expected: Low hit rate due to strided access pattern
// Demonstrates: Cache-unfriendly access patterns with std::vector

#include <iostream>
#include <vector>

constexpr size_t N = 64;

int main() {
  // 2D vector - stored in row-major order
  std::vector<std::vector<int>> matrix(N, std::vector<int>(N));
  int sum = 0;

  // Column-major access: stride of N*sizeof(int) bytes between accesses
  // Each access likely causes a cache miss
  for (size_t j = 0; j < N; ++j) {
    for (size_t i = 0; i < N; ++i) {
      matrix[i][j] = static_cast<int>(i + j);
    }
  }

  // Column-major read: same poor cache behavior
  for (size_t j = 0; j < N; ++j) {
    for (size_t i = 0; i < N; ++i) {
      sum += matrix[i][j];
    }
  }

  std::cout << "Sum: " << sum << '\n';
  return 0;
}
