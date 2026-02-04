# Changelog

## [1.5.0](https://github.com/AveryClapp/Cache-Explorer/compare/v1.4.0...v1.5.0) (2026-02-04)


### Features

* add automated Docker builds and semantic versioning ([e334eba](https://github.com/AveryClapp/Cache-Explorer/commit/e334ebaef7ba697500f3c3dc4a199ce01f5dcda4))
* add build-pass command for local compilation ([738afee](https://github.com/AveryClapp/Cache-Explorer/commit/738afee782aa6404f80917765a995a81dce350cf))
* add cache management commands ([c336708](https://github.com/AveryClapp/Cache-Explorer/commit/c3367082700f413f2d88a3b40511a8aa27ffd3bb))
* add comparison mode for before/after cache analysis ([73ca186](https://github.com/AveryClapp/Cache-Explorer/commit/73ca18679089209fd6c7d6b565a0634599b09fda))
* add comprehensive integration test suite ([9fb85d5](https://github.com/AveryClapp/Cache-Explorer/commit/9fb85d56c21d5dd17e699dcddf815ed91a80514d))
* add multi-file compilation support for backend ([de8ebd2](https://github.com/AveryClapp/Cache-Explorer/commit/de8ebd248b1cf97821cca2ffca35adad786915f2))
* add multi-version pass build script ([2c7d769](https://github.com/AveryClapp/Cache-Explorer/commit/2c7d769ddec2ea8dc5e6796c87f709e2601a1c7b))
* add pass download utility for auto-fetching from releases ([37f5058](https://github.com/AveryClapp/Cache-Explorer/commit/37f5058dc1417ca7f6e54d741b9d97a625e8c0a9))
* add progress bar with real-time event tracking ([ab2b64c](https://github.com/AveryClapp/Cache-Explorer/commit/ab2b64c80129dbf8cf320bab70e0300e8f1a4227))
* add robust Rust support via 4-stage LLVM pipeline ([110dd95](https://github.com/AveryClapp/Cache-Explorer/commit/110dd95cda2bd483df5a5d30a7f5bf737bc155a5))
* add Zig language support ([ab980cb](https://github.com/AveryClapp/Cache-Explorer/commit/ab980cb9857a22b624ad74b6738396023e35676f))
* enhance Compiler Explorer link with compiler and optimization selection ([32dbb4a](https://github.com/AveryClapp/Cache-Explorer/commit/32dbb4acf0501d70a58995ef223d4697c6063d36))
* file attribution in hot lines with grouping and filtering ([d60ffcf](https://github.com/AveryClapp/Cache-Explorer/commit/d60ffcf3eea44b29b42de903f0abab7ba7c83958))
* performance optimizations - segment caching and I/O pipeline (~19x speedup) ([a3d6005](https://github.com/AveryClapp/Cache-Explorer/commit/a3d6005c47db3ab06faaa20bea4fb90836fb0ec2))
* position Compiler Explorer as primary assembly view ([73f884c](https://github.com/AveryClapp/Cache-Explorer/commit/73f884c148f84b93a2c06cfe78eb6ec97d8a2648))
* styled dropdowns, 3C miss display, sampling, fast mode, and cancel button ([22b11c5](https://github.com/AveryClapp/Cache-Explorer/commit/22b11c54231c3b2e3e10580f15a070b8fe2a0b8b))


### Bug Fixes

* .mov -&gt; .mp4 ([166c397](https://github.com/AveryClapp/Cache-Explorer/commit/166c3974c4bcaa404fae7743c7a7fbcba414ce2f))
* add --json flag to websocket cache-explore command ([aba9c3c](https://github.com/AveryClapp/Cache-Explorer/commit/aba9c3c3e5a6c110ab6c04a6269a6dabfb44adc2))
* add zig to ProjectFile language type ([b38c60c](https://github.com/AveryClapp/Cache-Explorer/commit/b38c60cd62da49988aee3e312fe73005845b0f4f))
* align frontend and websocket eventLimit defaults to 100K ([0e0cd02](https://github.com/AveryClapp/Cache-Explorer/commit/0e0cd02d371accf3a4f5d7584a8d75dd89e9dfad))
* break circular dependency in useAnalysisState initialization ([f3aee1f](https://github.com/AveryClapp/Cache-Explorer/commit/f3aee1f5895ae3201ab0d71cfc9cc372c9d432f7))
* change release-please to simple type for C++ project ([c6cf34f](https://github.com/AveryClapp/Cache-Explorer/commit/c6cf34fba469a183b6b1c7321243f8738cabb65d))
* **ci:** enforce strict LLVM version consistency across build and test ([02b2e15](https://github.com/AveryClapp/Cache-Explorer/commit/02b2e155ec03c1606db1502c852286a6df75260c))
* **ci:** ensure tests use same LLVM version as pass build ([5025fe1](https://github.com/AveryClapp/Cache-Explorer/commit/5025fe17510e5f75ac5d0716133688f855ace2f1))
* **ci:** install Boost dependency for server build ([8f9f6d7](https://github.com/AveryClapp/Cache-Explorer/commit/8f9f6d71dc1e740de55ba0ea54b4bbad4f7612f5))
* **ci:** update deprecated GitHub Actions and add LLVM pass build ([96af18d](https://github.com/AveryClapp/Cache-Explorer/commit/96af18d9be1ec45a9c111ff3897fe3fe27134312))
* correct Compiler Explorer URL format and encoding ([3187a9c](https://github.com/AveryClapp/Cache-Explorer/commit/3187a9c96993092a6e14b25a54f087b23d026ea1))
* different approach with mp4 video ([1809789](https://github.com/AveryClapp/Cache-Explorer/commit/1809789be19cc1323f71edde7c8ffafb6223ec01))
* disable docker sandbox to use direct execution ([70a1911](https://github.com/AveryClapp/Cache-Explorer/commit/70a191180eb1dfbf66f723de54df36cb1122a816))
* docker-compose setup and favicon permissions ([55ce216](https://github.com/AveryClapp/Cache-Explorer/commit/55ce2168ec301428c4e7fb03cfcff719524b43c2))
* filter bash warnings from all stderr output paths ([80e3f0f](https://github.com/AveryClapp/Cache-Explorer/commit/80e3f0f7381601f8408483f0709fcdabd9d6fab8))
* filter out bash job control warnings from error output ([5b32cad](https://github.com/AveryClapp/Cache-Explorer/commit/5b32cad85e0c9ee7218fab1419a3545c1d4d15a7))
* github hosted demo video ([3ab3804](https://github.com/AveryClapp/Cache-Explorer/commit/3ab380433ffeba66433c5c24f97450808f5da5fa))
* **llvm-pass:** add missing Module.h include and fix LLVM 20 API ([e2c8d17](https://github.com/AveryClapp/Cache-Explorer/commit/e2c8d175e584dba931b76bfd6ddc5693dc1769ec))
* prevent infinite loop in URL state loading ([bead591](https://github.com/AveryClapp/Cache-Explorer/commit/bead59159721f61b203a7fcc03dd91e6437112b0))
* properly filter bash warnings from all error paths ([ce5c91b](https://github.com/AveryClapp/Cache-Explorer/commit/ce5c91b700d217fa0a70ab261b6c8f3934332497))
* reduce event limit to 100K and strip cacheState from output ([c31b6cf](https://github.com/AveryClapp/Cache-Explorer/commit/c31b6cf6f895d634d6ea1c08837ed568050ab834))
* remove deprecated package-name parameter from release-please ([f39ca2a](https://github.com/AveryClapp/Cache-Explorer/commit/f39ca2af8d2d193b5ed317a5701dfc97ebdb0d28))
* remove duplicate ceState variable declaration in openInCompilerExplorer ([7516fd1](https://github.com/AveryClapp/Cache-Explorer/commit/7516fd178e7f9e959df835f09edab4b59362c80a))
* remove segment caching ([aecaec2](https://github.com/AveryClapp/Cache-Explorer/commit/aecaec2610d40fbf0d0d3e90940f3c7c8097e1b9))
* results panel no longer in details component ([00c63c5](https://github.com/AveryClapp/Cache-Explorer/commit/00c63c533042af499e907bb71e79f4d01ea3e53c))
* support multiple source files on command line ([5ec6eed](https://github.com/AveryClapp/Cache-Explorer/commit/5ec6eed3e81e739b24d597fcde8fbb9e8e93b9e5))
* suppress bash job control warnings in sandboxed environments ([c40a495](https://github.com/AveryClapp/Cache-Explorer/commit/c40a495eb41e8717324f642005b445769148e343))
* **tests:** improve error output visibility in integration tests ([9ab4bde](https://github.com/AveryClapp/Cache-Explorer/commit/9ab4bdec849f78b78f62215f11906f531f37a67d))
* **tests:** remove set -e to allow error output to be displayed ([03796c1](https://github.com/AveryClapp/Cache-Explorer/commit/03796c139434266566be67758e574c356281c387))
* use empty dependency array for URL state callback ([ee22f46](https://github.com/AveryClapp/Cache-Explorer/commit/ee22f465a09d82a063edd63e2d72324ee08aae11))
* use proper Compiler Explorer state format with version and encoding ([2788f64](https://github.com/AveryClapp/Cache-Explorer/commit/2788f6430f888e9518e4b7de772c623213b101fd))
* use simple URL parameters for Compiler Explorer instead of complex state encoding ([27e9bf6](https://github.com/AveryClapp/Cache-Explorer/commit/27e9bf68ea574dc8799bfa5db7b6a527a2a954c4))


### Performance Improvements

* add MRU fast path to install_with_state() ([630fdd5](https://github.com/AveryClapp/Cache-Explorer/commit/630fdd534290205513c88297d7c4a18d31e0fd20))
* add vector reserves and likely hints to hot paths ([9306f75](https://github.com/AveryClapp/Cache-Explorer/commit/9306f75081ef8092e3601a9efe448c70d52cfbcb))
* cache bit widths in CacheLevel for faster address rebuild ([9897b3b](https://github.com/AveryClapp/Cache-Explorer/commit/9897b3bfb5e638d8902a31f06e1e65b28a0fa18d))
* eliminate string allocation in trace processor hot path ([c2b7480](https://github.com/AveryClapp/Cache-Explorer/commit/c2b7480ef617747bb4e8647ffe48769b69eec76c))
* pack CacheLine struct for better memory efficiency ([9ac3fce](https://github.com/AveryClapp/Cache-Explorer/commit/9ac3fcedbb85cfe7165ad5bdf5d99b5cd76c7928))

## [1.4.0](https://github.com/AveryClapp/Cache-Explorer/compare/v1.3.0...v1.4.0) (2026-02-01)


### Features

* add progress bar with real-time event tracking ([ab2b64c](https://github.com/AveryClapp/Cache-Explorer/commit/ab2b64c80129dbf8cf320bab70e0300e8f1a4227))

## [1.3.0](https://github.com/AveryClapp/Cache-Explorer/compare/v1.2.0...v1.3.0) (2026-02-01)


### Features

* performance optimizations - segment caching and I/O pipeline (~19x speedup) ([a3d6005](https://github.com/AveryClapp/Cache-Explorer/commit/a3d6005c47db3ab06faaa20bea4fb90836fb0ec2))

## [1.2.0](https://github.com/AveryClapp/Cache-Explorer/compare/v1.1.0...v1.2.0) (2026-02-01)


### Features

* add Zig language support ([ab980cb](https://github.com/AveryClapp/Cache-Explorer/commit/ab980cb9857a22b624ad74b6738396023e35676f))


### Bug Fixes

* add zig to ProjectFile language type ([b38c60c](https://github.com/AveryClapp/Cache-Explorer/commit/b38c60cd62da49988aee3e312fe73005845b0f4f))

## [1.1.0](https://github.com/AveryClapp/Cache-Explorer/compare/v1.0.1...v1.1.0) (2026-01-31)


### Features

* add automated Docker builds and semantic versioning ([e334eba](https://github.com/AveryClapp/Cache-Explorer/commit/e334ebaef7ba697500f3c3dc4a199ce01f5dcda4))
* add comparison mode for before/after cache analysis ([73ca186](https://github.com/AveryClapp/Cache-Explorer/commit/73ca18679089209fd6c7d6b565a0634599b09fda))
* add comprehensive integration test suite ([9fb85d5](https://github.com/AveryClapp/Cache-Explorer/commit/9fb85d56c21d5dd17e699dcddf815ed91a80514d))


### Bug Fixes

* .mov -&gt; .mp4 ([166c397](https://github.com/AveryClapp/Cache-Explorer/commit/166c3974c4bcaa404fae7743c7a7fbcba414ce2f))
* change release-please to simple type for C++ project ([c6cf34f](https://github.com/AveryClapp/Cache-Explorer/commit/c6cf34fba469a183b6b1c7321243f8738cabb65d))
* **ci:** enforce strict LLVM version consistency across build and test ([02b2e15](https://github.com/AveryClapp/Cache-Explorer/commit/02b2e155ec03c1606db1502c852286a6df75260c))
* **ci:** ensure tests use same LLVM version as pass build ([5025fe1](https://github.com/AveryClapp/Cache-Explorer/commit/5025fe17510e5f75ac5d0716133688f855ace2f1))
* **ci:** install Boost dependency for server build ([8f9f6d7](https://github.com/AveryClapp/Cache-Explorer/commit/8f9f6d71dc1e740de55ba0ea54b4bbad4f7612f5))
* **ci:** update deprecated GitHub Actions and add LLVM pass build ([96af18d](https://github.com/AveryClapp/Cache-Explorer/commit/96af18d9be1ec45a9c111ff3897fe3fe27134312))
* different approach with mp4 video ([1809789](https://github.com/AveryClapp/Cache-Explorer/commit/1809789be19cc1323f71edde7c8ffafb6223ec01))
* docker-compose setup and favicon permissions ([55ce216](https://github.com/AveryClapp/Cache-Explorer/commit/55ce2168ec301428c4e7fb03cfcff719524b43c2))
* github hosted demo video ([3ab3804](https://github.com/AveryClapp/Cache-Explorer/commit/3ab380433ffeba66433c5c24f97450808f5da5fa))
* **llvm-pass:** add missing Module.h include and fix LLVM 20 API ([e2c8d17](https://github.com/AveryClapp/Cache-Explorer/commit/e2c8d175e584dba931b76bfd6ddc5693dc1769ec))
* remove deprecated package-name parameter from release-please ([f39ca2a](https://github.com/AveryClapp/Cache-Explorer/commit/f39ca2af8d2d193b5ed317a5701dfc97ebdb0d28))
* results panel no longer in details component ([00c63c5](https://github.com/AveryClapp/Cache-Explorer/commit/00c63c533042af499e907bb71e79f4d01ea3e53c))
* **tests:** improve error output visibility in integration tests ([9ab4bde](https://github.com/AveryClapp/Cache-Explorer/commit/9ab4bdec849f78b78f62215f11906f531f37a67d))
* **tests:** remove set -e to allow error output to be displayed ([03796c1](https://github.com/AveryClapp/Cache-Explorer/commit/03796c139434266566be67758e574c356281c387))
