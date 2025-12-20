#include "../include/generator.h"
#include <cstdlib>
#include <format>

bool Generator::compileToIR(std::string_view inputFile,
                            std::string_view optimizationLevel) {
  std::string cmd = std::format("clang -S -emit-llvm -O{} -g {}",
                                optimizationLevel, inputFile);
  return system(cmd.c_str()) == 0;
}
