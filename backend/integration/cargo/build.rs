// build.rs - Cache Explorer Cargo integration
//
// Add this to your Cargo project to enable cache profiling.
//
// Usage in your Cargo.toml:
//   [build-dependencies]
//   cache-explorer = { path = "/path/to/cache-explorer/backend/integration/cargo" }
//
// Then in your build.rs:
//   fn main() {
//       cache_explorer::configure();
//   }
//
// Build with: CACHE_EXPLORER=1 cargo build
// Run analysis: cargo run 2>&1 | cache-sim --json

use std::env;
use std::path::PathBuf;

/// Configure Cargo to use Cache Explorer instrumentation
pub fn configure() {
    // Only enable if CACHE_EXPLORER=1 is set
    if env::var("CACHE_EXPLORER").unwrap_or_default() != "1" {
        return;
    }

    let cache_explorer_path = env::var("CACHE_EXPLORER_PATH")
        .unwrap_or_else(|_| find_cache_explorer().unwrap_or_default());

    if cache_explorer_path.is_empty() {
        eprintln!("Warning: CACHE_EXPLORER_PATH not set, skipping instrumentation");
        return;
    }

    let pass_path = format!("{}/llvm-pass/build/CacheProfiler.so", cache_explorer_path);
    let runtime_path = format!("{}/runtime/build/libcache-explorer-rt.a", cache_explorer_path);

    // Check that files exist
    if !PathBuf::from(&pass_path).exists() {
        eprintln!("Warning: CacheProfiler.so not found at {}", pass_path);
        return;
    }
    if !PathBuf::from(&runtime_path).exists() {
        eprintln!("Warning: libcache-explorer-rt.a not found at {}", runtime_path);
        return;
    }

    // Tell Cargo to use clang
    println!("cargo:rustc-env=CC=clang");
    println!("cargo:rustc-env=CXX=clang++");

    // Add LLVM pass plugin
    println!("cargo:rustc-link-arg=-Wl,-mllvm");
    println!("cargo:rustc-link-arg=-Wl,-load={}", pass_path);

    // Link runtime library
    println!("cargo:rustc-link-search=native={}/runtime/build", cache_explorer_path);
    println!("cargo:rustc-link-lib=static=cache-explorer-rt");

    // Enable debug info
    println!("cargo:rustc-link-arg=-g");

    eprintln!("Cache Explorer instrumentation enabled");
}

/// Try to find Cache Explorer installation
fn find_cache_explorer() -> Option<String> {
    // Check common locations
    let candidates = [
        "/usr/local/share/cache-explorer",
        "/opt/cache-explorer",
        &format!("{}/.cache-explorer", env::var("HOME").unwrap_or_default()),
    ];

    for path in &candidates {
        if PathBuf::from(path).exists() {
            return Some(path.to_string());
        }
    }

    None
}
