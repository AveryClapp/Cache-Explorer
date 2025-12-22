#pragma once
#include "llvm/IR/PassManager.h"
namespace llvm {

class CacheExplorerPass : public PassInfoMixin<CacheExplorerPass> {
public:
  PreservedAnalyses run(Function &F, FunctionAnalysisManager &AM);
};

void __tag_mem_load(void *load_addr, int64_t size, void *val);
void __tag_mem_store(void *store_addr, int64_t size, void *val);
}; // namespace llvm
