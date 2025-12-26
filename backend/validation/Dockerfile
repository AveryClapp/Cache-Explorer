# x86_64 Linux container for cachegrind validation
FROM --platform=linux/amd64 ubuntu:22.04

RUN apt-get update && apt-get install -y \
    valgrind \
    build-essential \
    clang \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /validation

# Default command shows cachegrind is working
CMD ["valgrind", "--version"]
