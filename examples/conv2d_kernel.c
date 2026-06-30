// Direct vs tiled 3x3 convolution kernel.
//
// Run direct:
//   ./backend/scripts/cache-explore examples/conv2d_kernel.c -O2 --hardware intel14 --json
//
// Run tiled:
//   ./backend/scripts/cache-explore examples/conv2d_kernel.c -O2 -D RUN_TILED=1 --hardware intel14 --json
//
// Compare modeled hardware:
//   ./backend/scripts/cache-explore compare examples/conv2d_kernel.c -O2 --configs intel14,zen4,m3
#include <stdio.h>

#ifndef RUN_TILED
#define RUN_TILED 0
#endif

#define IN_C 8
#define OUT_C 8
#define H 48
#define W 48
#define KH 3
#define KW 3
#define OH (H - KH + 1)
#define OW (W - KW + 1)
#define TILE_H 8
#define TILE_W 16

static float input[IN_C][H][W];
static float weight[OUT_C][IN_C][KH][KW];
static float output[OUT_C][OH][OW];

static void init_data(void) {
    for (int c = 0; c < IN_C; c++) {
        for (int y = 0; y < H; y++) {
            for (int x = 0; x < W; x++) {
                input[c][y][x] = (float)((c * 31 + y * 7 + x) & 15) * 0.0625f;
            }
        }
    }

    for (int oc = 0; oc < OUT_C; oc++) {
        for (int ic = 0; ic < IN_C; ic++) {
            for (int ky = 0; ky < KH; ky++) {
                for (int kx = 0; kx < KW; kx++) {
                    weight[oc][ic][ky][kx] =
                        (float)(((oc + 1) * (ic + 3) + ky * 5 + kx) & 7) * 0.03125f;
                }
            }
        }
    }
}

static void conv2d_direct(void) {
    for (int oc = 0; oc < OUT_C; oc++) {
        for (int oy = 0; oy < OH; oy++) {
            for (int ox = 0; ox < OW; ox++) {
                float sum = 0.0f;
                for (int ic = 0; ic < IN_C; ic++) {
                    for (int ky = 0; ky < KH; ky++) {
                        for (int kx = 0; kx < KW; kx++) {
                            sum += input[ic][oy + ky][ox + kx] *
                                   weight[oc][ic][ky][kx];
                        }
                    }
                }
                output[oc][oy][ox] = sum;
            }
        }
    }
}

static void conv2d_tiled(void) {
    for (int oc = 0; oc < OUT_C; oc++) {
        for (int ty = 0; ty < OH; ty += TILE_H) {
            for (int tx = 0; tx < OW; tx += TILE_W) {
                int y_end = ty + TILE_H < OH ? ty + TILE_H : OH;
                int x_end = tx + TILE_W < OW ? tx + TILE_W : OW;

                for (int oy = ty; oy < y_end; oy++) {
                    for (int ox = tx; ox < x_end; ox++) {
                        float sum = 0.0f;
                        for (int ic = 0; ic < IN_C; ic++) {
                            for (int ky = 0; ky < KH; ky++) {
                                for (int kx = 0; kx < KW; kx++) {
                                    sum += input[ic][oy + ky][ox + kx] *
                                           weight[oc][ic][ky][kx];
                                }
                            }
                        }
                        output[oc][oy][ox] = sum;
                    }
                }
            }
        }
    }
}

static float checksum(void) {
    float sum = 0.0f;
    for (int oc = 0; oc < OUT_C; oc++) {
        for (int y = 0; y < OH; y++) {
            for (int x = 0; x < OW; x++) {
                sum += output[oc][y][x];
            }
        }
    }
    return sum;
}

int main(void) {
    init_data();

#if RUN_TILED
    conv2d_tiled();
#else
    conv2d_direct();
#endif

    printf("checksum %.4f\n", checksum());
    return 0;
}
