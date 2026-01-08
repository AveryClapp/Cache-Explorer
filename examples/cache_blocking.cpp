// Cache blocking (tiling) optimization - improved cache behavior (C++ version)
// Expected: Better hit rate than naive matrix multiplication
// Demonstrates: Block/tile optimization technique, constexpr, templates

#include <iostream>
#include <vector>
#include <algorithm>

constexpr size_t N = 128;
constexpr size_t BLOCK_SIZE = 16;  // Typically 16-64 for L1 cache

using Matrix = std::vector<std::vector<double>>;

// Initialize matrix with test values
void init_matrix(Matrix& m, double base) {
  for (size_t i = 0; i < m.size(); ++i) {
    for (size_t j = 0; j < m[i].size(); ++j) {
      m[i][j] = base + static_cast<double>(i * m[i].size() + j) * 0.001;
    }
  }
}

// Naive matrix multiply - poor cache behavior for large matrices
void multiply_naive(const Matrix& A, const Matrix& B, Matrix& C) {
  const size_t n = A.size();
  for (size_t i = 0; i < n; ++i) {
    for (size_t j = 0; j < n; ++j) {
      double sum = 0.0;
      for (size_t k = 0; k < n; ++k) {
        sum += A[i][k] * B[k][j];  // B[k][j] has stride-N access
      }
      C[i][j] = sum;
    }
  }
}

// Blocked matrix multiply - better cache behavior
template<size_t BlockSize>
void multiply_blocked(const Matrix& A, const Matrix& B, Matrix& C) {
  const size_t n = A.size();

  // Process matrix in blocks
  for (size_t ii = 0; ii < n; ii += BlockSize) {
    for (size_t jj = 0; jj < n; jj += BlockSize) {
      for (size_t kk = 0; kk < n; kk += BlockSize) {
        // Multiply block
        const size_t i_end = std::min(ii + BlockSize, n);
        const size_t j_end = std::min(jj + BlockSize, n);
        const size_t k_end = std::min(kk + BlockSize, n);

        for (size_t i = ii; i < i_end; ++i) {
          for (size_t j = jj; j < j_end; ++j) {
            double sum = C[i][j];
            for (size_t k = kk; k < k_end; ++k) {
              sum += A[i][k] * B[k][j];
            }
            C[i][j] = sum;
          }
        }
      }
    }
  }
}

int main() {
  Matrix A(N, std::vector<double>(N));
  Matrix B(N, std::vector<double>(N));
  Matrix C(N, std::vector<double>(N, 0.0));

  init_matrix(A, 1.0);
  init_matrix(B, 2.0);

  // Use blocked multiply for better cache performance
  multiply_blocked<BLOCK_SIZE>(A, B, C);

  // Print a sample value to prevent optimization
  std::cout << "C[0][0]: " << C[0][0] << '\n';
  std::cout << "C[N-1][N-1]: " << C[N-1][N-1] << '\n';

  return 0;
}
