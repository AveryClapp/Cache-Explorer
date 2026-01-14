// Row-major access - cache friendly!
#include <stdio.h>
#define N 256

int main() {
    int matrix[N][N];

    for (int row = 0; row < N; row++)
        for (int col = 0; col < N; col++)
            matrix[row][col] = row + col;

    return 0;
}
