/* Repository-owned PE32 decompiler fixture: no game assets or external code. */
volatile unsigned cells[128];
__declspec(dllexport) __declspec(noinline) unsigned update_world(unsigned count) {
  unsigned sum = 0;
  for (unsigned i = 0; i < count; ++i) {
    cells[i & 127] += i;
    sum += cells[(i * 7) & 127];
  }
  return sum;
}
void entry(void) { cells[0] = update_world(64); }
