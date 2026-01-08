// Linked list traversal - poor cache behavior (C++ version)
// Expected: Low hit rate due to pointer chasing
// Demonstrates: std::unique_ptr, custom allocator benefits

#include <iostream>
#include <memory>

constexpr size_t N = 1000;

struct Node {
  int value;
  std::unique_ptr<Node> next;

  explicit Node(int v) : value(v), next(nullptr) {}
};

// Create linked list with scattered allocations (poor cache behavior)
std::unique_ptr<Node> create_scattered_list(size_t n) {
  if (n == 0) return nullptr;

  auto head = std::make_unique<Node>(0);
  Node* current = head.get();

  for (size_t i = 1; i < n; ++i) {
    current->next = std::make_unique<Node>(static_cast<int>(i));
    current = current->next.get();
  }

  return head;
}

// Traverse list - pointer chasing causes cache misses
int sum_list(const Node* head) {
  int sum = 0;
  const Node* current = head;
  while (current != nullptr) {
    sum += current->value;
    current = current->next.get();
  }
  return sum;
}

int main() {
  // Allocate nodes in random order to simulate fragmented memory
  auto list = create_scattered_list(N);

  // Traverse - each node access likely misses cache
  int sum = sum_list(list.get());

  std::cout << "Sum: " << sum << '\n';
  return 0;
}
