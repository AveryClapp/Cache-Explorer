// Minimal test - no printf, no libc calls
// Just pure array access for clean comparison

#ifndef N
#define N 1000
#endif

int arr[N];
int result;

int main() {
    // Sequential write
    for (int i = 0; i < N; i++) {
        arr[i] = i;
    }

    // Sequential read
    int sum = 0;
    for (int i = 0; i < N; i++) {
        sum += arr[i];
    }

    result = sum;  // Prevent optimization
    return 0;
}
