//! Cache Explorer - Rust Integration
//!
//! This crate provides integration for profiling Rust programs with Cache Explorer.
//!
//! # Quick Start
//!
//! Add to your `Cargo.toml`:
//!
//! ```toml
//! [build-dependencies]
//! cache-explorer = { path = "/path/to/cache-explorer/backend/integration/cargo" }
//! ```
//!
//! Create or modify `build.rs`:
//!
//! ```rust,ignore
//! fn main() {
//!     cache_explorer::configure();
//! }
//! ```
//!
//! Build and run with profiling:
//!
//! ```bash
//! CACHE_EXPLORER=1 cargo build
//! cargo run 2>&1 | cache-sim --json
//! ```
//!
//! # Environment Variables
//!
//! - `CACHE_EXPLORER=1` - Enable instrumentation
//! - `CACHE_EXPLORER_PATH` - Path to Cache Explorer installation
//! - `CACHE_EXPLORER_INCLUDE_STL=1` - Include STL code in profiling

use std::env;
use std::path::PathBuf;

/// Configure Cargo to use Cache Explorer instrumentation.
///
/// Call this from your build.rs to enable cache profiling.
/// Instrumentation is only enabled when `CACHE_EXPLORER=1` is set.
pub fn configure() {
    // Only enable if CACHE_EXPLORER=1 is set
    if env::var("CACHE_EXPLORER").unwrap_or_default() != "1" {
        return;
    }

    let cache_explorer_path = env::var("CACHE_EXPLORER_PATH")
        .unwrap_or_else(|_| find_cache_explorer().unwrap_or_default());

    if cache_explorer_path.is_empty() {
        eprintln!("cargo:warning=CACHE_EXPLORER_PATH not set, skipping instrumentation");
        return;
    }

    let pass_path = format!("{}/backend/llvm-pass/build/CacheProfiler.so", cache_explorer_path);
    let runtime_path = format!("{}/backend/runtime/build", cache_explorer_path);

    // Check that files exist
    if !PathBuf::from(&pass_path).exists() {
        // Try alternate path (top-level build)
        let alt_pass = format!("{}/build/backend/llvm-pass/CacheProfiler.so", cache_explorer_path);
        if PathBuf::from(&alt_pass).exists() {
            configure_with_paths(&alt_pass, &format!("{}/build/backend/runtime", cache_explorer_path));
            return;
        }
        eprintln!("cargo:warning=CacheProfiler.so not found at {}", pass_path);
        return;
    }

    configure_with_paths(&pass_path, &runtime_path);
}

fn configure_with_paths(pass_path: &str, runtime_dir: &str) {
    // Rerun if these change
    println!("cargo:rerun-if-env-changed=CACHE_EXPLORER");
    println!("cargo:rerun-if-env-changed=CACHE_EXPLORER_PATH");
    println!("cargo:rerun-if-changed={}", pass_path);

    // Link runtime library
    println!("cargo:rustc-link-search=native={}", runtime_dir);
    println!("cargo:rustc-link-lib=static=cache-explorer-rt");

    // Note: Rust's LLVM integration makes it tricky to use -fpass-plugin
    // For now, recommend using cache-explore CLI wrapper instead
    eprintln!("cargo:warning=Cache Explorer: Use 'cache-explore cargo build' for full instrumentation");
}

/// Try to find Cache Explorer installation
fn find_cache_explorer() -> Option<String> {
    // Check common locations
    let home = env::var("HOME").unwrap_or_default();

    let candidates = [
        format!("{}/cache-explorer", home),
        format!("{}/.local/share/cache-explorer", home),
        "/usr/local/share/cache-explorer".to_string(),
        "/opt/cache-explorer".to_string(),
    ];

    for path in &candidates {
        let check = PathBuf::from(path).join("backend/llvm-pass/build/CacheProfiler.so");
        if check.exists() {
            return Some(path.clone());
        }
    }

    // Check if we're in the cache-explorer repo
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let repo_root = PathBuf::from(&manifest_dir)
            .ancestors()
            .find(|p| p.join("CLAUDE.md").exists());
        if let Some(root) = repo_root {
            return Some(root.to_string_lossy().to_string());
        }
    }

    None
}

/// Marker trait for types that should be profiled
pub trait CacheProfile {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_cache_explorer() {
        // Should not panic
        let _ = find_cache_explorer();
    }
}
