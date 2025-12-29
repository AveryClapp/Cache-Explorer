// String Search - Sequential Scan Pattern
// Demonstrates good cache behavior of linear text search
#include <stdio.h>
#include <string.h>

#define TEXT_SIZE 100000

char text[TEXT_SIZE];
const char* pattern = "needle";

// Simple substring search
int count_occurrences() {
    int count = 0;
    int pattern_len = strlen(pattern);

    for (int i = 0; i <= TEXT_SIZE - pattern_len; i++) {
        int match = 1;
        for (int j = 0; j < pattern_len && match; j++) {
            if (text[i + j] != pattern[j]) {
                match = 0;
            }
        }
        if (match) count++;
    }

    return count;
}

int main() {
    // Fill text with mostly 'a's, some 'needle's
    for (int i = 0; i < TEXT_SIZE; i++) {
        text[i] = 'a';
    }

    // Insert some patterns to find
    for (int i = 0; i < TEXT_SIZE - 10; i += 1000) {
        memcpy(&text[i], "needle", 6);
    }

    int found = count_occurrences();
    printf("Found %d occurrences\n", found);

    return 0;
}
