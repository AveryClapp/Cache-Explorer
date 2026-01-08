/**
 * Compiler Discovery and Management
 * Discovers available LLVM/Clang versions on the system
 *
 * Note: Cache Explorer requires LLVM/Clang for instrumentation via -fpass-plugin.
 * GCC is not supported as it doesn't support LLVM passes.
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';

// Common paths where LLVM/Clang might be installed
const COMMON_PATHS = [
  // Homebrew on macOS (Apple Silicon)
  '/opt/homebrew/opt/llvm/bin',
  '/opt/homebrew/opt/llvm@21/bin',
  '/opt/homebrew/opt/llvm@20/bin',
  '/opt/homebrew/opt/llvm@19/bin',
  '/opt/homebrew/opt/llvm@18/bin',
  '/opt/homebrew/opt/llvm@17/bin',
  '/opt/homebrew/opt/llvm@16/bin',
  '/opt/homebrew/opt/llvm@15/bin',
  // Homebrew on macOS (Intel)
  '/usr/local/opt/llvm/bin',
  '/usr/local/opt/llvm@21/bin',
  '/usr/local/opt/llvm@20/bin',
  '/usr/local/opt/llvm@19/bin',
  '/usr/local/opt/llvm@18/bin',
  '/usr/local/opt/llvm@17/bin',
  '/usr/local/opt/llvm@16/bin',
  '/usr/local/opt/llvm@15/bin',
  // Linux package managers (LLVM/Clang)
  '/usr/lib/llvm-21/bin',
  '/usr/lib/llvm-20/bin',
  '/usr/lib/llvm-19/bin',
  '/usr/lib/llvm-18/bin',
  '/usr/lib/llvm-17/bin',
  '/usr/lib/llvm-16/bin',
  '/usr/lib/llvm-15/bin',
  '/usr/lib/llvm-14/bin',
  // Xcode Command Line Tools (Apple Clang)
  '/Library/Developer/CommandLineTools/usr/bin',
  // Xcode.app (Apple Clang)
  '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin',
  // System paths
  '/usr/bin',
];

// Cache discovered compilers
let compilerCache = null;

/**
 * Get the version of a clang binary
 */
function getClangVersion(clangPath) {
  try {
    const output = execSync(`"${clangPath}" --version 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000,
    });

    // Check if this is Apple Clang (different versioning scheme)
    const isAppleClang = output.includes('Apple clang') || output.includes('Apple LLVM');

    // Parse version from output like "Homebrew clang version 21.1.8" or "clang version 17.0.6"
    // or "Apple clang version 15.0.0"
    const match = output.match(/clang version (\d+)\.(\d+)/);
    if (match) {
      return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        full: `${match[1]}.${match[2]}`,
        isAppleClang,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a path has the required LLVM tools for Cache Explorer
 */
function hasRequiredTools(binPath) {
  const clang = `${binPath}/clang`;
  const clangpp = `${binPath}/clang++`;
  const opt = `${binPath}/opt`;

  return existsSync(clang) && existsSync(clangpp) && existsSync(opt);
}

/**
 * Discover all available LLVM/Clang installations
 */
export function discoverCompilers() {
  if (compilerCache) {
    return compilerCache;
  }

  const compilers = [];
  const seenVersions = new Set();

  for (const binPath of COMMON_PATHS) {
    const clangPath = `${binPath}/clang`;

    if (!existsSync(clangPath)) {
      continue;
    }

    if (!hasRequiredTools(binPath)) {
      continue;
    }

    const version = getClangVersion(clangPath);
    if (!version) {
      continue;
    }

    // Avoid duplicates (same version from different paths)
    const versionKey = version.full;
    if (seenVersions.has(versionKey)) {
      continue;
    }
    seenVersions.add(versionKey);

    // Determine source/label
    let source = 'system';
    if (binPath.includes('homebrew')) {
      source = 'homebrew';
    } else if (binPath.includes('/usr/lib/llvm')) {
      source = 'apt';
    } else if (binPath.includes('Xcode') || binPath.includes('CommandLineTools')) {
      source = 'xcode';
    }

    // Use different naming for Apple Clang vs LLVM Clang
    const id = version.isAppleClang
      ? `apple-clang-${version.major}`
      : `clang-${version.major}`;
    const name = version.isAppleClang
      ? `Apple Clang ${version.full}`
      : `Clang ${version.full}`;

    compilers.push({
      id,
      name,
      version: version.full,
      major: version.major,
      path: binPath,
      source,
      isAppleClang: version.isAppleClang || false,
    });
  }

  // Also check for versioned clang in PATH (e.g., clang-17, clang-18)
  for (let ver = 14; ver <= 21; ver++) {
    try {
      const which = execSync(`which clang-${ver} 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 2000,
      }).trim();

      if (which) {
        const version = getClangVersion(which);
        // Check if we already have this major version
        if (version && !seenVersions.has(version.full)) {
          const binPath = which.replace(/\/clang-\d+$/, '');
          compilers.push({
            id: `clang-${ver}`,
            name: `Clang ${version.full}`,
            version: version.full,
            major: version.major,
            path: binPath,
            source: 'path',
          });
          seenVersions.add(version.full);
        }
      }
    } catch {
      // clang-X not found, continue
    }
  }

  // Sort by major version descending (newest first)
  compilers.sort((a, b) => b.major - a.major);

  // Mark default (first/newest)
  if (compilers.length > 0) {
    compilers[0].default = true;
  }

  compilerCache = compilers;
  return compilers;
}

/**
 * Get a specific compiler by ID
 */
export function getCompiler(id) {
  const compilers = discoverCompilers();
  return compilers.find(c => c.id === id) || compilers[0];
}

/**
 * Get the default compiler
 */
export function getDefaultCompiler() {
  const compilers = discoverCompilers();
  return compilers.find(c => c.default) || compilers[0];
}

/**
 * Refresh the compiler cache (e.g., after new installation)
 */
export function refreshCompilers() {
  compilerCache = null;
  return discoverCompilers();
}

export default {
  discoverCompilers,
  getCompiler,
  getDefaultCompiler,
  refreshCompilers,
};
