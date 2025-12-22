#include "CacheExplorerPass.hpp"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/PassManager.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Passes/PassPlugin.h"

// Functions to include live in the LLVM namespace
using namespace llvm;

PreservedAnalyses CacheExplorerPass::run(Function &F,
                                         FunctionAnalysisManager &AM) {
  Module *M = F.getParent();
  LLVMContext &Ctx = M->getContext();

  Function *TagLoad = M->getFunction("_tag_mem_load");
  Function *TagStore = M->getFunction("_tag_mem_store");

  // Loop through all functions and blocks
  for (auto &BB : F) {
    for (auto &I : BB) {
      // If we see a Load or Store instance, insert a call to our logger
      if (auto *LI = dyn_cast<LoadInst>(&I)) {
        IRBuilder<> Builder(&I);
        Value *Addr = LI->getPointerOperand();
        Builder.CreateCall(__tag_mem_load, {Addr});
      } else if (auto *SI = dyn_cast<StoreInst>(&I)) {
        IRBuilder<> Builder(&I);
        Value *Addr = SI->getPointerOperand();
        Value *Val = SI->getValueOperand();
        Builder.CreateCall(__tag_mem_store, {Addr, Val});
      }
    }
  }
  return llvm::PreservedAnalyses::none();
}
