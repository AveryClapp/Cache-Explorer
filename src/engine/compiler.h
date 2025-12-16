#pragma once

#include <string>
#include <memory>

namespace llvm {
class Module;
class LLVMContext;
} // namespace llvm

namespace CacheExplorer {

/**
 * Compiles C/C++ code to LLVM IR using Clang
 */
class Compiler {
public:
    Compiler();
    ~Compiler();

    /**
     * Compile source code to LLVM IR
     * @param source_code C/C++ source code
     * @param optimization_level -O0, -O1, -O2, -O3
     * @return LLVM Module containing the IR
     */
    std::unique_ptr<llvm::Module> compile_to_ir(
        const std::string& source_code,
        const std::string& optimization_level = "-O0"
    );

    /**
     * Get the LLVM context
     */
    llvm::LLVMContext& get_context();

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace CacheExplorer
