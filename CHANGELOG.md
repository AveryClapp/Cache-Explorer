# Changelog

## [1.6.0](https://github.com/AveryClapp/Cache-Explorer/compare/v1.5.1...v1.6.0) (2026-04-14)


### Features

* fix Zig language support (macOS linking, test infrastructure) ([f8767a2](https://github.com/AveryClapp/Cache-Explorer/commit/f8767a26a5e1e5674a3d860570840a4c950e879b))
* move loop cache to main toolbar as styled toggle button ([9f2f2ca](https://github.com/AveryClapp/Cache-Explorer/commit/9f2f2caef797e2c7ba5b7d8cc15b1443d26c8a20))
* segment caching for repeated loop patterns (--cache-segments) ([5529314](https://github.com/AveryClapp/Cache-Explorer/commit/552931412a4faf90086c0b115e580a208dd843a3))
* selective instrumentation (--instrument-only, --exclude) ([3c21098](https://github.com/AveryClapp/Cache-Explorer/commit/3c210985f333ccf782a8e7ffeccd1cc92bb10016))
* wire --cache-segments flag to web frontend and server ([9644590](https://github.com/AveryClapp/Cache-Explorer/commit/96445901f695b48d95152d55737649519baf1bc8))


### Bug Fixes

* add --cache-segments flag to cache-explore script ([b7d7519](https://github.com/AveryClapp/Cache-Explorer/commit/b7d75190b99a385a55341cac0a70c86140bf1237))
* correct glob matching in selective instrumentation ([0c15f52](https://github.com/AveryClapp/Cache-Explorer/commit/0c15f52ec53fad96dee4c0acbaa045c7c9ae6aa3))

## [1.5.1](https://github.com/AveryClapp/Cache-Explorer/compare/v1.5.0...v1.5.1) (2026-03-11)


### Bug Fixes

* use absolute path for cmake integration test in master runner ([59d935f](https://github.com/AveryClapp/Cache-Explorer/commit/59d935f5422f33e3b5c71c365d38c92522a3b350))
* use CACHE_EXPLORER_CC env var for toolchain compiler on Linux CI ([b837685](https://github.com/AveryClapp/Cache-Explorer/commit/b83768595b372d9831af2438085af1f5addfde7c))
* use CACHE_EXPLORER_CC for find_package test compiler detection ([be6d081](https://github.com/AveryClapp/Cache-Explorer/commit/be6d081595b2acec0b7fa51c0a18d0cc78255429))

## [1.5.0](https://github.com/AveryClapp/Cache-Explorer/compare/v1.4.1...v1.5.0) (2026-03-11)


### Features

* add cmake integration tests and documentation ([c95ea2b](https://github.com/AveryClapp/Cache-Explorer/commit/c95ea2bc95b9cb89cd6214c843b6814908a97128))

## [1.4.1](https://github.com/AveryClapp/Cache-Explorer/compare/v1.4.0...v1.4.1) (2026-02-04)


### Bug Fixes

* remove segment caching ([aecaec2](https://github.com/AveryClapp/Cache-Explorer/commit/aecaec2610d40fbf0d0d3e90940f3c7c8097e1b9))

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
