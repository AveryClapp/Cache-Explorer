#include "CacheExplorerPass.hpp"
#include "llvm/IR/DebugInfoMetadata.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/PassManager.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Passes/PassPlugin.h"
#include "llvm/Support/raw_ostream.h"

using namespace llvm;

// Configuration flags - set via environment variables
// CACHE_EXPLORER_DEBUG=1 - enable debug output
// CACHE_EXPLORER_INCLUDE_STL=1 - instrument STL/standard library (disabled by default)
static bool DebugFiltering = false;
static bool IncludeStdLib = false;
static bool ConfigInitialized = false;

static void initConfig() {
  if (!ConfigInitialized) {
    ConfigInitialized = true;
    if (const char *env = getenv("CACHE_EXPLORER_DEBUG")) {
      DebugFiltering = (env[0] == '1');
    }
    if (const char *env = getenv("CACHE_EXPLORER_INCLUDE_STL")) {
      IncludeStdLib = (env[0] == '1');
      if (DebugFiltering && IncludeStdLib)
        errs() << "[CacheExplorer] STL instrumentation ENABLED\n";
    }
  }
}

namespace {

// Counter for generating unique basic block IDs (avoids BlockAddress issues on ARM64)
static uint64_t GlobalBBCounter = 0;

/// Check if a source file path is from system/library headers that should be skipped
bool isSystemHeader(StringRef Filename) {
  // Always skip empty or synthetic filenames (no source info available)
  if (Filename.empty())
    return true;
  if (Filename.starts_with("<") || Filename == "<unknown>")
    return true;

  // If user wants STL instrumentation, include system headers
  if (IncludeStdLib)
    return false;

  // Skip standard library headers (angle-bracket includes become these paths)
  if (Filename.starts_with("/usr/include") ||
      Filename.starts_with("/usr/lib") ||
      Filename.starts_with("/usr/local/include") ||
      Filename.starts_with("/Library/Developer") ||      // macOS SDK
      Filename.starts_with("/Applications/Xcode") ||     // Xcode toolchain
      Filename.starts_with("/opt/homebrew") ||           // Homebrew on ARM Mac
      Filename.starts_with("/usr/local/Cellar") ||       // Homebrew on Intel Mac
      Filename.contains("/include/c++/") ||              // libstdc++ headers
      Filename.contains("/include/bits/") ||             // GCC internal headers
      Filename.contains("/include/ext/") ||              // GCC extensions
      Filename.contains("/__clang/") ||                  // Clang builtin headers
      Filename.contains("/lib/clang/"))                  // Clang resource dir
    return true;

  return false;
}

/// Quick check for STL/library function names (faster than debug info lookup)
bool isLibraryFunctionName(StringRef Name) {
  // If user explicitly wants STL instrumentation, don't filter by name
  if (IncludeStdLib)
    return false;

  // C++ STL functions are mangled with _ZNSt (libc++) or _ZSt (libstdc++)
  if (Name.starts_with("_ZNSt") || Name.starts_with("_ZSt"))
    return true;

  // LLVM internal functions
  if (Name.starts_with("__clang_") || Name.starts_with("__cxx_"))
    return true;

  // C library functions (mangled)
  if (Name.starts_with("__libc_") || Name.starts_with("__gxx_"))
    return true;

  // Rust standard library functions (mangled names)
  // _ZN3std - std::*
  // _ZN4core - core::*
  // _ZN5alloc - alloc::*
  if (Name.starts_with("_ZN3std") || Name.starts_with("_ZN4core") ||
      Name.starts_with("_ZN5alloc"))
    return true;

  return false;
}

/// Check if a function should be instrumented
bool shouldInstrumentFunction(const Function &F) {
  initConfig();

  // Skip declarations (no body)
  if (F.isDeclaration())
    return false;

  // Skip LLVM intrinsics
  if (F.isIntrinsic())
    return false;

  // Fast path: check function name first (avoids debug info lookup)
  StringRef FuncName = F.getName();
  if (isLibraryFunctionName(FuncName)) {
    // Only log in debug mode (expensive string operations)
    if (DebugFiltering)
      errs() << "[SKIP libfunc] " << FuncName << "\n";
    return false;
  }

  // Skip functions with no debug info at all
  if (!F.getSubprogram()) {
    if (DebugFiltering)
      errs() << "[SKIP no-dbg] " << FuncName << "\n";
    return false;
  }

  // Check if the function's source file is a system header
  if (DISubprogram *SP = F.getSubprogram()) {
    if (SP->getFile()) {
      StringRef Filename = SP->getFile()->getFilename();
      StringRef Directory = SP->getFile()->getDirectory();

      // Build full path for checking
      SmallString<256> FullPath;
      if (!Directory.empty() && !Filename.starts_with("/")) {
        FullPath = Directory;
        FullPath += "/";
        FullPath += Filename;
      } else {
        FullPath = Filename;
      }

      if (isSystemHeader(FullPath)) {
        if (DebugFiltering)
          errs() << "[SKIP sysheader] " << FuncName << " @ " << FullPath << "\n";
        return false;
      }

      if (DebugFiltering)
        errs() << "[INSTRUMENT] " << FuncName << " @ " << FullPath << "\n";
    }
  }

  return true;
}

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
  initConfig();
  if (DebugFiltering)
    errs() << "[CacheExplorer] run() called for function: " << F.getName() << "\n";

  // Skip functions from system headers (STL, libc, etc.)
  if (!shouldInstrumentFunction(F))
    return PreservedAnalyses::all();

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

  // Software prefetch instrumentation
  Function *TagPrefetch = M->getFunction("__tag_prefetch");
  if (!TagPrefetch) {
    FunctionType *PrefetchFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx),
                           Type::getInt8Ty(Ctx), PointerType::getUnqual(Ctx),
                           Type::getInt32Ty(Ctx)},
                          false);
    TagPrefetch = Function::Create(PrefetchFnTy, Function::ExternalLinkage,
                                   "__tag_prefetch", M);
  }

  // Vector/SIMD instrumentation
  Function *TagVectorLoad = M->getFunction("__tag_vector_load");
  if (!TagVectorLoad) {
    FunctionType *VecLoadFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx),
                           PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx)},
                          false);
    TagVectorLoad = Function::Create(VecLoadFnTy, Function::ExternalLinkage,
                                     "__tag_vector_load", M);
  }

  Function *TagVectorStore = M->getFunction("__tag_vector_store");
  if (!TagVectorStore) {
    FunctionType *VecStoreFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx),
                           PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx)},
                          false);
    TagVectorStore = Function::Create(VecStoreFnTy, Function::ExternalLinkage,
                                      "__tag_vector_store", M);
  }

  // Atomic operation instrumentation
  Function *TagAtomicLoad = M->getFunction("__tag_atomic_load");
  if (!TagAtomicLoad) {
    FunctionType *AtomicLoadFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx),
                           PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx)},
                          false);
    TagAtomicLoad = Function::Create(AtomicLoadFnTy, Function::ExternalLinkage,
                                     "__tag_atomic_load", M);
  }

  Function *TagAtomicRMW = M->getFunction("__tag_atomic_rmw");
  if (!TagAtomicRMW) {
    FunctionType *AtomicRMWFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx),
                           PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx)},
                          false);
    TagAtomicRMW = Function::Create(AtomicRMWFnTy, Function::ExternalLinkage,
                                    "__tag_atomic_rmw", M);
  }

  Function *TagAtomicStore = M->getFunction("__tag_atomic_store");
  if (!TagAtomicStore) {
    FunctionType *AtomicStoreFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx),
                           PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx)},
                          false);
    TagAtomicStore = Function::Create(AtomicStoreFnTy, Function::ExternalLinkage,
                                      "__tag_atomic_store", M);
  }

  Function *TagAtomicCmpxchg = M->getFunction("__tag_atomic_cmpxchg");
  if (!TagAtomicCmpxchg) {
    FunctionType *AtomicCmpxchgFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx),
                           PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx)},
                          false);
    TagAtomicCmpxchg = Function::Create(AtomicCmpxchgFnTy, Function::ExternalLinkage,
                                        "__tag_atomic_cmpxchg", M);
  }

  // Memory intrinsic instrumentation
  Function *TagMemcpy = M->getFunction("__tag_memcpy");
  if (!TagMemcpy) {
    FunctionType *MemcpyFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), PointerType::getUnqual(Ctx),
                           Type::getInt32Ty(Ctx), PointerType::getUnqual(Ctx),
                           Type::getInt32Ty(Ctx)},
                          false);
    TagMemcpy = Function::Create(MemcpyFnTy, Function::ExternalLinkage,
                                 "__tag_memcpy", M);
  }

  Function *TagMemset = M->getFunction("__tag_memset");
  if (!TagMemset) {
    FunctionType *MemsetFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx),
                           PointerType::getUnqual(Ctx), Type::getInt32Ty(Ctx)},
                          false);
    TagMemset = Function::Create(MemsetFnTy, Function::ExternalLinkage,
                                 "__tag_memset", M);
  }

  Function *TagMemmove = M->getFunction("__tag_memmove");
  if (!TagMemmove) {
    FunctionType *MemmoveFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {PointerType::getUnqual(Ctx), PointerType::getUnqual(Ctx),
                           Type::getInt32Ty(Ctx), PointerType::getUnqual(Ctx),
                           Type::getInt32Ty(Ctx)},
                          false);
    TagMemmove = Function::Create(MemmoveFnTy, Function::ExternalLinkage,
                                  "__tag_memmove", M);
  }

  // I-cache tracking: uses a unique ID instead of BlockAddress (ARM64 compatible)
  Function *TagBBEntry = M->getFunction("__tag_bb_entry");
  if (!TagBBEntry) {
    // Changed first param to i64 for unique BB ID instead of pointer
    FunctionType *BBFnTy =
        FunctionType::get(Type::getVoidTy(Ctx),
                          {Type::getInt64Ty(Ctx), Type::getInt32Ty(Ctx),
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
    // IMPORTANT: Skip landing pad blocks - landingpad must be first non-PHI instruction
    if (firstDbgLoc && instrCount > 0) {
      Instruction *firstInst = &*BB.begin();

      // Skip PHI nodes to find the first real instruction
      while (isa<PHINode>(firstInst))
        firstInst = firstInst->getNextNode();

      // Don't instrument exception handler blocks (C++ exception handling)
      if (isa<LandingPadInst>(firstInst))
        continue;

      IRBuilder<> Builder(firstInst);

      // Use a unique counter instead of BlockAddress (fixes ARM64 issues)
      Value *BBID = ConstantInt::get(Type::getInt64Ty(Ctx), GlobalBBCounter++);
      Value *InstrCount = ConstantInt::get(Type::getInt32Ty(Ctx), instrCount);
      Value *File = Builder.CreateGlobalString((*firstDbgLoc)->getFilename());
      Value *Line = ConstantInt::get(Type::getInt32Ty(Ctx), (*firstDbgLoc)->getLine());

      Builder.CreateCall(TagBBEntry, {BBID, InstrCount, File, Line});
    }

    // Data cache tracking: instrument loads, stores, atomics, vectors, intrinsics
    for (auto &I : BB) {
      // Skip compiler-generated code without source location
      if (!I.getDebugLoc())
        continue;

      // Also check per-instruction if it's from a system header
      // (handles inlined code from STL)
      if (const DebugLoc &DbgLoc = I.getDebugLoc()) {
        StringRef Filename = DbgLoc->getFilename();
        if (isSystemHeader(Filename))
          continue;
      }

      // Check for AtomicRMW instruction
      if (auto *RMWI = dyn_cast<AtomicRMWInst>(&I)) {
        auto data = prepareInstrumentation(M, Ctx, I, RMWI->getPointerOperand(),
                                           RMWI->getValOperand()->getType());
        IRBuilder<> Builder(&I);
        Builder.CreateCall(TagAtomicRMW,
                           {data.Addr, data.SizeVal, data.File, data.Line});
        continue;
      }

      // Check for AtomicCmpXchg instruction
      if (auto *CASI = dyn_cast<AtomicCmpXchgInst>(&I)) {
        auto data = prepareInstrumentation(M, Ctx, I, CASI->getPointerOperand(),
                                           CASI->getCompareOperand()->getType());
        IRBuilder<> Builder(&I);
        Builder.CreateCall(TagAtomicCmpxchg,
                           {data.Addr, data.SizeVal, data.File, data.Line});
        continue;
      }

      // Check for calls to intrinsics (prefetch, memcpy, memset, memmove)
      if (auto *CI = dyn_cast<CallInst>(&I)) {
        if (Function *Callee = CI->getCalledFunction()) {
          StringRef Name = Callee->getName();

          // llvm.prefetch intrinsic
          if (Name.starts_with("llvm.prefetch")) {
            Value *Addr = CI->getArgOperand(0);
            // Prefetch hint is in arg 3 (0=T0, 1=T1, 2=T2, 3=NTA)
            Value *Hint = CI->getNumOperands() >= 4 ? CI->getArgOperand(3)
                          : ConstantInt::get(Type::getInt8Ty(Ctx), 0);
            IRBuilder<> Builder(&I);
            Value *SizeVal = ConstantInt::get(Type::getInt32Ty(Ctx), 64);  // Cache line
            Value *File = Builder.CreateGlobalString(I.getDebugLoc()->getFilename());
            Value *Line = ConstantInt::get(Type::getInt32Ty(Ctx), I.getDebugLoc()->getLine());
            // Truncate hint to i8 if needed
            if (Hint->getType() != Type::getInt8Ty(Ctx))
              Hint = Builder.CreateTrunc(Hint, Type::getInt8Ty(Ctx));
            Builder.CreateCall(TagPrefetch, {Addr, SizeVal, Hint, File, Line});
            continue;
          }

          // llvm.memcpy intrinsic
          if (Name.starts_with("llvm.memcpy")) {
            Value *Dest = CI->getArgOperand(0);
            Value *Src = CI->getArgOperand(1);
            Value *Len = CI->getArgOperand(2);
            IRBuilder<> Builder(&I);
            Value *SizeVal = Builder.CreateTrunc(Len, Type::getInt32Ty(Ctx));
            Value *File = Builder.CreateGlobalString(I.getDebugLoc()->getFilename());
            Value *Line = ConstantInt::get(Type::getInt32Ty(Ctx), I.getDebugLoc()->getLine());
            Builder.CreateCall(TagMemcpy, {Dest, Src, SizeVal, File, Line});
            continue;
          }

          // llvm.memset intrinsic
          if (Name.starts_with("llvm.memset")) {
            Value *Dest = CI->getArgOperand(0);
            Value *Len = CI->getArgOperand(2);
            IRBuilder<> Builder(&I);
            Value *SizeVal = Builder.CreateTrunc(Len, Type::getInt32Ty(Ctx));
            Value *File = Builder.CreateGlobalString(I.getDebugLoc()->getFilename());
            Value *Line = ConstantInt::get(Type::getInt32Ty(Ctx), I.getDebugLoc()->getLine());
            Builder.CreateCall(TagMemset, {Dest, SizeVal, File, Line});
            continue;
          }

          // llvm.memmove intrinsic
          if (Name.starts_with("llvm.memmove")) {
            Value *Dest = CI->getArgOperand(0);
            Value *Src = CI->getArgOperand(1);
            Value *Len = CI->getArgOperand(2);
            IRBuilder<> Builder(&I);
            Value *SizeVal = Builder.CreateTrunc(Len, Type::getInt32Ty(Ctx));
            Value *File = Builder.CreateGlobalString(I.getDebugLoc()->getFilename());
            Value *Line = ConstantInt::get(Type::getInt32Ty(Ctx), I.getDebugLoc()->getLine());
            Builder.CreateCall(TagMemmove, {Dest, Src, SizeVal, File, Line});
            continue;
          }
        }
      }

      // Load instruction
      if (auto *LI = dyn_cast<LoadInst>(&I)) {
        auto data = prepareInstrumentation(M, Ctx, I, LI->getPointerOperand(),
                                           LI->getType());
        IRBuilder<> Builder(&I);

        // Check if it's an atomic load
        if (LI->isAtomic()) {
          Builder.CreateCall(TagAtomicLoad,
                             {data.Addr, data.SizeVal, data.File, data.Line});
        }
        // Check if it's a vector load
        else if (LI->getType()->isVectorTy()) {
          Builder.CreateCall(TagVectorLoad,
                             {data.Addr, data.SizeVal, data.File, data.Line});
        }
        // Regular load
        else {
          Builder.CreateCall(TagLoad,
                             {data.Addr, data.SizeVal, data.File, data.Line});
        }
        continue;
      }

      // Store instruction
      if (auto *SI = dyn_cast<StoreInst>(&I)) {
        auto data = prepareInstrumentation(M, Ctx, I, SI->getPointerOperand(),
                                           SI->getValueOperand()->getType());
        IRBuilder<> Builder(&I);

        // Check if it's an atomic store
        if (SI->isAtomic()) {
          Builder.CreateCall(TagAtomicStore,
                             {data.Addr, data.SizeVal, data.File, data.Line});
        }
        // Check if it's a vector store
        else if (SI->getValueOperand()->getType()->isVectorTy()) {
          Builder.CreateCall(TagVectorStore,
                             {data.Addr, data.SizeVal, data.File, data.Line});
        }
        // Regular store
        else {
          Builder.CreateCall(TagStore,
                             {data.Addr, data.SizeVal, data.File, data.Line});
        }
        continue;
      }
    }
  }

  return PreservedAnalyses::none();
}

// Module-level pass that iterates over all functions
PreservedAnalyses CacheExplorerModulePass::run(Module &M,
                                               ModuleAnalysisManager &AM) {
  initConfig();
  if (DebugFiltering)
    errs() << "[CacheExplorer] ModulePass running on " << M.getName() << "\n";

  bool Changed = false;
  FunctionAnalysisManager DummyFAM;

  for (Function &F : M) {
    if (F.isDeclaration())
      continue;

    // Early filter at module level - skip STL functions before calling run()
    if (!shouldInstrumentFunction(F))
      continue;

    if (DebugFiltering)
      errs() << "[CacheExplorer] Processing function: " << F.getName() << "\n";

    // Run the function pass logic directly
    CacheExplorerPass FP;
    PreservedAnalyses PA = FP.run(F, DummyFAM);
    if (!PA.areAllPreserved())
      Changed = true;
  }

  return Changed ? PreservedAnalyses::none() : PreservedAnalyses::all();
}

extern "C" LLVM_ATTRIBUTE_WEAK ::llvm::PassPluginLibraryInfo
llvmGetPassPluginInfo() {
  return {LLVM_PLUGIN_API_VERSION, "CacheExplorer", LLVM_VERSION_STRING,
          [](PassBuilder &PB) {
            initConfig();
            if (DebugFiltering)
              errs() << "[CacheExplorer] Plugin registering callbacks\n";

            // Use OptimizerLastEPCallback for all optimization levels
            // This is the most reliable way to run after IR is generated
            // LLVM 20+ added ThinOrFullLTOPhase parameter
#if LLVM_VERSION_MAJOR >= 20
            PB.registerOptimizerLastEPCallback([](ModulePassManager &MPM,
                                                  OptimizationLevel OL,
                                                  ThinOrFullLTOPhase) {
#else
            PB.registerOptimizerLastEPCallback([](ModulePassManager &MPM,
                                                  OptimizationLevel OL) {
#endif
              if (DebugFiltering)
                errs() << "[CacheExplorer] OptimizerLast callback, OL="
                       << (int)OL.getSpeedupLevel() << "\n";
              // Use module pass that manually iterates functions
              MPM.addPass(CacheExplorerModulePass());
            });

            // Allow manual invocation via -passes=cache-explorer-module
            PB.registerPipelineParsingCallback(
                [](StringRef Name, ModulePassManager &MPM,
                   ArrayRef<PassBuilder::PipelineElement>) {
                  if (Name == "cache-explorer-module") {
                    MPM.addPass(CacheExplorerModulePass());
                    return true;
                  }
                  return false;
                });

            // Allow manual invocation via -passes=cache-explorer (function level)
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
