// Column-major access - cache unfriendly!
#include <stdio.h>
#define N 256

int main() {
    int matrix[N][N];

    for (int col = 0; col < N; col++)
        for (int row = 0; row < N; row++)
            matrix[row][col] = row + col;

    return 0;
}
