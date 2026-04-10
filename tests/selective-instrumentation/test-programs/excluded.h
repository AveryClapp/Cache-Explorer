// This file should be EXCLUDED from instrumentation
inline void excluded_function() {
    int arr[50];
    for (int i = 0; i < 50; i++) {
        arr[i] = i * 3;  // EXPECT: NO events (file excluded)
    }
}
