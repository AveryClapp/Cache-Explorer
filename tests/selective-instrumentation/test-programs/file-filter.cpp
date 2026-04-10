// Test Case 3: File-based filtering
// This file should be instrumented based on CLI flags
#include <cstdio>
#include "excluded.h"

void instrumented_function() {
    int arr[50];
    for (int i = 0; i < 50; i++) {
        arr[i] = i * 2;  // EXPECT: Events generated (this file included)
    }
}

int main() {
    instrumented_function();  // Should generate events
    excluded_function();      // Should NOT generate events (from excluded.h)
    return 0;
}
