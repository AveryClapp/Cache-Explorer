#pragma once
#include "llvm/IR/PassManager.h"
namespace llvm {

class CacheExplorerPass : public PassInfoMixin<CacheExplorerPass> {
public:
  PreservedAnalyses run(Function &F, FunctionAnalysisManager &AM);
};

} // namespace llvm
