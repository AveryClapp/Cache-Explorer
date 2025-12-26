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

  uint64_t Size = M->getDataLayout().getTypeStoreSize(AccessType);
  Value *SizeVal = ConstantInt::get(Type::getInt32Ty(Ctx), Size);

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

  // I-cache tracking: instrument basic block entries
  Function *TagBBEntry = M->getFunction("__tag_bb_entry");
  if (!TagBBEntry) {
    FunctionType *BBFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx),
                           PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx)},
                          false);
    TagBBEntry = Function::Create(BBFnTy, Function::ExternalLinkage,
                                  "__tag_bb_entry", M);
  }

  for (auto &BB : F) {
    // Count instructions in this basic block for I-cache simulation
    uint32_t instrCount = 0;
    const DebugLoc *firstDbgLoc = nullptr;

    for (auto &I : BB) {
      instrCount++;
      if (!firstDbgLoc && I.getDebugLoc()) {
        firstDbgLoc = &I.getDebugLoc();
      }
    }

    // Insert BB entry tracking at the start of each block (if it has debug info)
    if (firstDbgLoc && instrCount > 0) {
      Instruction *firstInst = &*BB.begin();
      IRBuilder<> Builder(firstInst);

      // Use blockaddress to get a unique identifier for this BB
      Value *BBAddr = BlockAddress::get(&BB);
      Value *InstrCount = ConstantInt::get(Type::getInt32Ty(Ctx), instrCount);
      Value *File = Builder.CreateGlobalString((*firstDbgLoc)->getFilename());
      Value *Line = ConstantInt::get(Type::getInt32Ty(Ctx), (*firstDbgLoc)->getLine());

      Builder.CreateCall(TagBBEntry, {BBAddr, InstrCount, File, Line});
    }

    // Data cache tracking: instrument loads and stores
    for (auto &I : BB) {
      // Skip compiler-generated code without source location
      if (!I.getDebugLoc())
        continue;

      if (auto *LI = dyn_cast<LoadInst>(&I)) {
        auto data = prepareInstrumentation(M, Ctx, I, LI->getPointerOperand(),
                                           LI->getType());
        IRBuilder<> Builder(&I);
        Builder.CreateCall(TagLoad,
                           {data.Addr, data.SizeVal, data.File, data.Line});
      } else if (auto *SI = dyn_cast<StoreInst>(&I)) {
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

extern "C" LLVM_ATTRIBUTE_WEAK ::llvm::PassPluginLibraryInfo
llvmGetPassPluginInfo() {
  return {LLVM_PLUGIN_API_VERSION, "CacheExplorer", LLVM_VERSION_STRING,
          [](PassBuilder &PB) {
            PB.registerOptimizerLastEPCallback([](ModulePassManager &MPM,
                                                  OptimizationLevel,
                                                  ThinOrFullLTOPhase) {
              MPM.addPass(
                  createModuleToFunctionPassAdaptor(CacheExplorerPass()));
            });
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
