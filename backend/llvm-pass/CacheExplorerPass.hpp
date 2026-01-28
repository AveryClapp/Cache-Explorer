#pragma once
#include "llvm/IR/Module.h"
#include "llvm/IR/PassManager.h"
namespace llvm {

// Function-level pass for individual function instrumentation
class CacheExplorerPass : public PassInfoMixin<CacheExplorerPass> {
public:
  PreservedAnalyses run(Function &F, FunctionAnalysisManager &AM);
};

// Module-level pass that iterates over all functions
class CacheExplorerModulePass : public PassInfoMixin<CacheExplorerModulePass> {
public:
  PreservedAnalyses run(Module &M, ModuleAnalysisManager &AM);
};

} // namespace llvm
