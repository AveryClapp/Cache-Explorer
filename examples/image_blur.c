// Image Blur - Real-World Cache Pattern
// 3x3 box blur demonstrating 2D stencil access
#include <stdio.h>

#define WIDTH 512
#define HEIGHT 512

unsigned char input[HEIGHT][WIDTH];
unsigned char output[HEIGHT][WIDTH];

// 3x3 box blur with row-major traversal.
static void blur_row_major(void) {
    for (int y = 1; y < HEIGHT - 1; y++) {
        for (int x = 1; x < WIDTH - 1; x++) {
            int sum = 0;
            // Access 3x3 neighborhood
            for (int dy = -1; dy <= 1; dy++) {
                for (int dx = -1; dx <= 1; dx++) {
                    sum += input[y + dy][x + dx];
                }
            }
            output[y][x] = sum / 9;
        }
    }
}

// Same stencil, but column-major traversal fights the image's row-major layout.
static void blur_column_major(void) {
    for (int x = 1; x < WIDTH - 1; x++) {
        for (int y = 1; y < HEIGHT - 1; y++) {
            int sum = 0;
            for (int dy = -1; dy <= 1; dy++) {
                for (int dx = -1; dx <= 1; dx++) {
                    sum += input[y + dy][x + dx];
                }
            }
            output[y][x] = sum / 9;
        }
    }
}

int main() {
    // Initialize with gradient pattern
    for (int y = 0; y < HEIGHT; y++) {
        for (int x = 0; x < WIDTH; x++) {
            input[y][x] = (x + y) % 256;
        }
    }

    // Apply blur
#ifdef RUN_COLUMN_MAJOR
    blur_column_major();
#else
    blur_row_major();
#endif

    // Checksum
    int sum = 0;
    for (int y = 0; y < HEIGHT; y++)
        for (int x = 0; x < WIDTH; x++)
            sum += output[y][x];

    printf("Checksum: %d\n", sum);
    return 0;
}
