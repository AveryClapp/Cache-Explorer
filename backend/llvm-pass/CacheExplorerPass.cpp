#include "CacheExplorerPass.hpp"
#include "llvm/IR/DebugInfoMetadata.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/PassManager.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Passes/PassPlugin.h"

using namespace llvm;

namespace {

struct InstrumentationData {
  Value *Addr;
  Value *SizeVal;
  Value *File;
  Value *Line;
};

InstrumentationData prepareInstrumentation(Module *M, LLVMContext &Ctx,
                                           Instruction &I, Value *Addr,
                                           Type *AccessType) {
  IRBuilder<> Builder(&I);

  // Get size of memory access
  uint64_t Size = M->getDataLayout().getTypeStoreSize(AccessType);
  Value *SizeVal = ConstantInt::get(Type::getInt32Ty(Ctx), Size);

  // Get file and line from debug info
  const DebugLoc &DbgLoc = I.getDebugLoc();
  Value *File;
  Value *Line;

  if (DbgLoc) {
    File = Builder.CreateGlobalString(DbgLoc->getFilename());
    Line = ConstantInt::get(Type::getInt32Ty(Ctx), DbgLoc->getLine());
  } else {
    File = Builder.CreateGlobalString("<unknown>");
    Line = ConstantInt::get(Type::getInt32Ty(Ctx), 0);
  }

  return {Addr, SizeVal, File, Line};
}

} // anonymous namespace

PreservedAnalyses CacheExplorerPass::run(Function &F,
                                         FunctionAnalysisManager &AM) {
  Module *M = F.getParent();
  LLVMContext &Ctx = M->getContext();

  // Declare runtime tracking functions if they don't exist
  Function *TagLoad = M->getFunction("__tag_mem_load");
  if (!TagLoad) {
    FunctionType *LoadFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx),
                           PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx)},
                          false);
    TagLoad = Function::Create(LoadFnTy, Function::ExternalLinkage,
                               "__tag_mem_load", M);
  }

  Function *TagStore = M->getFunction("__tag_mem_store");
  if (!TagStore) {
    FunctionType *StoreFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx),
                           PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx)},
                          false);
    TagStore = Function::Create(StoreFnTy, Function::ExternalLinkage,
                                "__tag_mem_store", M);
  }

  // Instrument all load and store instructions
  for (auto &BB : F) {
    for (auto &I : BB) {

      // Handle LOAD instructions
      if (auto *LI = dyn_cast<LoadInst>(&I)) {
        auto data = prepareInstrumentation(M, Ctx, I, LI->getPointerOperand(),
                                           LI->getType());

        IRBuilder<> Builder(&I);
        Builder.CreateCall(TagLoad,
                           {data.Addr, data.SizeVal, data.File, data.Line});
      }

      // Handle STORE instructions
      else if (auto *SI = dyn_cast<StoreInst>(&I)) {
        auto data = prepareInstrumentation(M, Ctx, I, SI->getPointerOperand(),
                                           SI->getValueOperand()->getType());

        IRBuilder<> Builder(&I);
        Builder.CreateCall(TagStore,
                           {data.Addr, data.SizeVal, data.File, data.Line});
      }
    }
  }

  return PreservedAnalyses::none();
}

// Register this pass with the LLVM Pass Manager
extern "C" LLVM_ATTRIBUTE_WEAK ::llvm::PassPluginLibraryInfo
llvmGetPassPluginInfo() {
  return {LLVM_PLUGIN_API_VERSION, "CacheExplorer", LLVM_VERSION_STRING,
          [](PassBuilder &PB) {
            PB.registerPipelineParsingCallback(
                [](StringRef Name, FunctionPassManager &FPM,
                   ArrayRef<PassBuilder::PipelineElement>) {
                  if (Name == "cache-explorer") {
                    FPM.addPass(CacheExplorerPass());
                    return true;
                  }
                  return false;
                });
          }};
}
