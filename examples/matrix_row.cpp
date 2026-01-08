// Row-major matrix traversal - good cache behavior (C++ version)
// Expected: High hit rate
// Demonstrates: 2D std::vector, templates, nested loops

#include <iostream>
#include <vector>

constexpr size_t N = 64;

// Template function to initialize matrix
template<typename T>
void init_matrix(std::vector<std::vector<T>>& matrix) {
  for (size_t i = 0; i < matrix.size(); ++i) {
    for (size_t j = 0; j < matrix[i].size(); ++j) {
      matrix[i][j] = static_cast<T>(i + j);
    }
  }
}

// Template function to sum matrix
template<typename T>
T sum_matrix(const std::vector<std::vector<T>>& matrix) {
  T sum = 0;
  for (const auto& row : matrix) {
    for (const auto& val : row) {
      sum += val;
    }
  }
  return sum;
}

int main() {
  // 2D vector - row-major layout (good for cache)
  std::vector<std::vector<int>> matrix(N, std::vector<int>(N));

  // Row-major initialization: sequential in memory
  init_matrix(matrix);

  // Row-major traversal: sequential reads
  int sum = sum_matrix(matrix);

  std::cout << "Sum: " << sum << '\n';
  return 0;
}
