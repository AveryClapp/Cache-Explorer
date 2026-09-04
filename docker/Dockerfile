# Hardware Explorer Preview sandbox container
# Isolated environment for compiling and running untrusted user code
# Multi-stage build: compiles components from source for Linux compatibility

# ============================================================
# Stage 1: Build Cache Explorer components
# ============================================================
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Install prerequisites for adding LLVM repository
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    software-properties-common \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Add LLVM 20 repository
RUN for attempt in 1 2 3 4 5; do \
      wget -qO /etc/apt/trusted.gpg.d/apt.llvm.org.asc https://apt.llvm.org/llvm-snapshot.gpg.key && break; \
      if [ "$attempt" -eq 5 ]; then exit 1; fi; \
      sleep 5; \
    done \
    && echo "deb https://apt.llvm.org/jammy/ llvm-toolchain-jammy-20 main" > /etc/apt/sources.list.d/llvm.list

# Install build dependencies
RUN apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
    clang-20 \
    llvm-20-dev \
    lld-20 \
    libc6-dev \
    cmake \
    ninja-build \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/clang-20 /usr/bin/clang \
    && ln -s /usr/bin/clang++-20 /usr/bin/clang++

WORKDIR /build

# Copy source files
COPY backend/llvm-pass /build/llvm-pass
COPY backend/runtime /build/runtime
COPY backend/cache-simulator /build/cache-simulator

# Build LLVM pass
RUN mkdir -p /build/llvm-pass/build && cd /build/llvm-pass/build \
    && cmake .. -G Ninja \
       -DCMAKE_BUILD_TYPE=Release \
       -DLLVM_DIR=/usr/lib/llvm-20/cmake \
    && ninja

# Build runtime library
# -mno-outline-atomics prevents LLVM outline atomics that require compiler-rt
RUN mkdir -p /build/runtime/build && cd /build/runtime/build \
    && cmake .. -G Ninja -DCMAKE_BUILD_TYPE=Release \
       -DCMAKE_C_FLAGS="-mno-outline-atomics" \
    && ninja \
    && clang -c /build/runtime/zig_stubs.c -o /build/runtime/build/zig_stubs.o

# Build cache simulator
RUN mkdir -p /build/cache-simulator/build && cd /build/cache-simulator/build \
    && cmake .. -G Ninja -DCMAKE_BUILD_TYPE=Release \
    && ninja

# ============================================================
# Stage 2: Runtime image (minimal)
# ============================================================
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install prerequisites for adding LLVM repository
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Add LLVM 20 repository
RUN for attempt in 1 2 3 4 5; do \
      wget -qO /etc/apt/trusted.gpg.d/apt.llvm.org.asc https://apt.llvm.org/llvm-snapshot.gpg.key && break; \
      if [ "$attempt" -eq 5 ]; then exit 1; fi; \
      sleep 5; \
    done \
    && echo "deb https://apt.llvm.org/jammy/ llvm-toolchain-jammy-20 main" > /etc/apt/sources.list.d/llvm.list

# Install runtime dependencies including opt for bitcode pipeline
RUN apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
    clang-20 \
    lld-20 \
    llvm-20 \
    libc6-dev \
    libstdc++6 \
    libatomic1 \
    libgcc-11-dev \
    curl \
    xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/clang-20 /usr/bin/clang \
    && ln -s /usr/bin/clang++-20 /usr/bin/clang++ \
    && ln -s /usr/bin/lld-20 /usr/bin/lld \
    && ln -s /usr/bin/opt-20 /usr/bin/opt \
    && ln -s /usr/bin/llc-20 /usr/bin/llc \
    && ln -s /usr/bin/clang /usr/bin/cc

# Install the pinned Zig archive only after verifying the upstream checksum.
ARG ZIG_VERSION=0.15.2
RUN ARCH="$(uname -m)" \
    && case "$ARCH" in \
      x86_64) ZIG_SHA256="02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239" ;; \
      aarch64) ZIG_SHA256="958ed7d1e00d0ea76590d27666efbf7a932281b3d7ba0c6b01b0ff26498f667f" ;; \
      *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;; \
    esac \
    && ZIG_ARCHIVE="zig-${ARCH}-linux-${ZIG_VERSION}.tar.xz" \
    && curl --fail --show-error --location --proto '=https' --tlsv1.2 \
      --connect-timeout 15 --max-time 300 \
      "https://ziglang.org/download/${ZIG_VERSION}/${ZIG_ARCHIVE}" \
      --output "/tmp/${ZIG_ARCHIVE}" \
    && echo "${ZIG_SHA256}  /tmp/${ZIG_ARCHIVE}" | sha256sum --check --strict \
    && tar xJf "/tmp/${ZIG_ARCHIVE}" -C /opt \
    && rm "/tmp/${ZIG_ARCHIVE}" \
    && ln -s "/opt/zig-${ARCH}-linux-${ZIG_VERSION}/zig" /usr/local/bin/zig

# Create app directory
RUN mkdir -p /opt/cache-explorer

# Copy built artifacts from builder stage
COPY --from=builder /build/llvm-pass/build/CacheProfiler.so /opt/cache-explorer/
COPY --from=builder /build/runtime/build/libcache-explorer-rt.a /opt/cache-explorer/
COPY --from=builder /build/runtime/build/zig_stubs.o /opt/cache-explorer/
COPY --from=builder /build/cache-simulator/build/cache-sim /opt/cache-explorer/

# Copy entrypoint script
COPY docker/run.sh /opt/cache-explorer/

# Make binaries executable and scripts readable
RUN chmod 755 /opt/cache-explorer/cache-sim /opt/cache-explorer/run.sh \
    && chmod 644 /opt/cache-explorer/libcache-explorer-rt.a \
    && chmod 755 /opt/cache-explorer/CacheProfiler.so

# Create non-root user for execution
RUN useradd -r -s /bin/false sandbox

# Switch to non-root user
USER sandbox
WORKDIR /tmp

# Entrypoint script handles compilation and execution
ENTRYPOINT ["/opt/cache-explorer/run.sh"]
