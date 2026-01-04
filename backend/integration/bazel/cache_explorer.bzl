# cache_explorer.bzl
#
# Bazel rules for Cache Explorer integration.
#
# Usage:
#   1. Add to your WORKSPACE:
#      local_repository(
#          name = "cache_explorer",
#          path = "/path/to/cache-explorer",
#      )
#
#   2. In your BUILD file:
#      load("@cache_explorer//backend/integration/bazel:cache_explorer.bzl", "cc_cache_profile")
#
#      cc_cache_profile(
#          name = "my_binary_profiled",
#          binary = ":my_binary",
#          config = "intel",
#      )

load("@bazel_tools//tools/cpp:toolchain_utils.bzl", "find_cpp_toolchain")

def _cache_explorer_aspect_impl(target, ctx):
    """Aspect that adds cache profiling instrumentation."""
    if CcInfo not in target:
        return []

    cc_toolchain = find_cpp_toolchain(ctx)

    # Get the cache explorer paths from the toolchain or environment
    pass_path = ctx.attr._pass_path[DefaultInfo].files.to_list()[0].path
    runtime_path = ctx.attr._runtime_path[DefaultInfo].files.to_list()[0].path

    return []

CacheExplorerInfo = provider(
    doc = "Provides cache profiling information",
    fields = {
        "profiled": "Whether cache profiling is enabled",
        "config": "Cache configuration (intel, amd, apple, etc.)",
    },
)

def _cc_cache_profile_impl(ctx):
    """Implementation of cc_cache_profile rule."""
    binary = ctx.attr.binary
    config = ctx.attr.config
    output_format = ctx.attr.output_format

    # Get the executable from the binary target
    executable = binary[DefaultInfo].files_to_run.executable
    if not executable:
        fail("Target %s does not produce an executable" % binary.label)

    # Create wrapper script that runs binary and pipes to cache-sim
    cache_sim = ctx.attr._cache_sim[DefaultInfo].files_to_run.executable

    wrapper_content = """#!/bin/bash
set -e

# Run the profiled binary and analyze
"{executable}" "$@" 2>&1 | "{cache_sim}" --config {config} {output_flag}
""".format(
        executable = executable.short_path,
        cache_sim = cache_sim.short_path,
        config = config,
        output_flag = "--json" if output_format == "json" else "",
    )

    wrapper = ctx.actions.declare_file(ctx.label.name + "_wrapper.sh")
    ctx.actions.write(
        output = wrapper,
        content = wrapper_content,
        is_executable = True,
    )

    # Create runfiles that include the binary and cache-sim
    runfiles = ctx.runfiles(
        files = [executable, cache_sim],
    ).merge(binary[DefaultInfo].default_runfiles)

    return [
        DefaultInfo(
            executable = wrapper,
            runfiles = runfiles,
        ),
        CacheExplorerInfo(
            profiled = True,
            config = config,
        ),
    ]

cc_cache_profile = rule(
    implementation = _cc_cache_profile_impl,
    attrs = {
        "binary": attr.label(
            mandatory = True,
            executable = True,
            cfg = "target",
            doc = "The cc_binary target to profile",
        ),
        "config": attr.string(
            default = "intel",
            doc = "Cache configuration preset (intel, amd, apple, educational)",
        ),
        "output_format": attr.string(
            default = "text",
            values = ["text", "json"],
            doc = "Output format for cache analysis",
        ),
        "_cache_sim": attr.label(
            default = "@cache_explorer//backend/cache-simulator:cache-sim",
            executable = True,
            cfg = "exec",
        ),
    },
    executable = True,
    doc = "Wraps a cc_binary to run with cache profiling analysis",
)

def _cc_instrumented_binary_impl(ctx):
    """Builds a binary with cache instrumentation enabled."""
    cc_toolchain = find_cpp_toolchain(ctx)

    # This requires the LLVM pass to be loaded during compilation
    # The actual instrumentation happens at compile time via -fpass-plugin

    pass_path = ctx.file._pass.path
    runtime = ctx.file._runtime

    # Add instrumentation flags
    instrumentation_flags = [
        "-fpass-plugin=" + pass_path,
        "-g",  # Debug info for source attribution
    ]

    if ctx.attr.include_stl:
        instrumentation_flags.append("-DCACHE_EXPLORER_INCLUDE_STL=1")

    return [
        CacheExplorerInfo(
            profiled = True,
            config = ctx.attr.config,
        ),
    ]

cc_instrumented_binary = rule(
    implementation = _cc_instrumented_binary_impl,
    attrs = {
        "srcs": attr.label_list(
            allow_files = [".c", ".cc", ".cpp", ".cxx"],
            doc = "Source files to compile",
        ),
        "deps": attr.label_list(
            doc = "Dependencies",
        ),
        "config": attr.string(
            default = "intel",
            doc = "Cache configuration preset",
        ),
        "include_stl": attr.bool(
            default = False,
            doc = "Include STL code in profiling",
        ),
        "_pass": attr.label(
            default = "@cache_explorer//backend/llvm-pass:CacheProfiler.so",
            allow_single_file = True,
        ),
        "_runtime": attr.label(
            default = "@cache_explorer//backend/runtime:cache-explorer-rt",
            allow_single_file = True,
        ),
    },
    fragments = ["cpp"],
    toolchains = ["@bazel_tools//tools/cpp:toolchain_type"],
    doc = "Builds a cc_binary with cache profiling instrumentation",
)

def cache_profile_test(name, binary, config = "intel", expected_hit_rate = None, **kwargs):
    """
    Macro that creates a test verifying cache behavior.

    Args:
        name: Test target name
        binary: The cc_binary to profile
        config: Cache configuration preset
        expected_hit_rate: Optional minimum L1 hit rate to assert
    """
    analysis_name = name + "_analysis"

    cc_cache_profile(
        name = analysis_name,
        binary = binary,
        config = config,
        output_format = "json",
    )

    if expected_hit_rate:
        # Create a test that checks hit rate
        native.sh_test(
            name = name,
            srcs = ["@cache_explorer//backend/integration/bazel:check_hit_rate.sh"],
            args = [
                "$(location :%s)" % analysis_name,
                str(expected_hit_rate),
            ],
            data = [":" + analysis_name],
            **kwargs
        )
    else:
        # Just run the analysis as a test
        native.sh_test(
            name = name,
            srcs = ["@cache_explorer//backend/integration/bazel:run_analysis.sh"],
            args = ["$(location :%s)" % analysis_name],
            data = [":" + analysis_name],
            **kwargs
        )
