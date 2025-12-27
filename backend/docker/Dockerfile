# Cache Explorer Sandbox Container
# Secure execution environment for untrusted user code

FROM ubuntu:22.04 AS base

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install LLVM/Clang and build tools
RUN apt-get update && apt-get install -y \
    clang-15 \
    llvm-15 \
    llvm-15-dev \
    cmake \
    ninja-build \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create symlinks for clang/clang++
RUN ln -sf /usr/bin/clang-15 /usr/bin/clang && \
    ln -sf /usr/bin/clang++-15 /usr/bin/clang++ && \
    ln -sf /usr/bin/llvm-config-15 /usr/bin/llvm-config

# Create non-root user for execution
RUN useradd -m -s /bin/bash sandbox && \
    mkdir -p /app /workspace && \
    chown -R sandbox:sandbox /workspace

WORKDIR /app

# Copy pre-built binaries (built on host, copied in)
COPY --chown=root:root llvm-pass/build/CacheProfiler.so /app/lib/
COPY --chown=root:root runtime/build/libcache-explorer-rt.a /app/lib/
COPY --chown=root:root runtime/cache-explorer-rt.h /app/include/
COPY --chown=root:root cache-simulator/build/cache-sim /app/bin/
COPY --chown=root:root docker/sandbox-run.sh /app/bin/

# Make sandbox script executable
RUN chmod +x /app/bin/sandbox-run.sh /app/bin/cache-sim

# Set up environment
ENV PASS_PATH=/app/lib/CacheProfiler.so
ENV RUNTIME_LIB=/app/lib/libcache-explorer-rt.a
ENV RUNTIME_INC=/app/include
ENV CACHE_SIM=/app/bin/cache-sim
ENV PATH=/app/bin:$PATH

# Switch to non-root user
USER sandbox
WORKDIR /workspace

# Default command
ENTRYPOINT ["/app/bin/sandbox-run.sh"]
