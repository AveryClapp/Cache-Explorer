#!/bin/bash
# Validation Server Setup Script
# One-time setup for a Linux server to run hardware validation
#
# Usage: sudo ./setup-server.sh
#
# This script:
# 1. Enables perf counters for non-root users
# 2. Installs required dependencies
# 3. Verifies perf works correctly

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}=== Cache Explorer Validation Server Setup ===${NC}"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}Error: This script must be run as root (sudo)${NC}"
    exit 1
fi

# Check if Linux
if [[ "$(uname)" != "Linux" ]]; then
    echo -e "${RED}Error: This script only works on Linux${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/4] Enabling perf counters for all users...${NC}"

# Enable perf for non-root users (persists across reboots)
echo 0 > /proc/sys/kernel/perf_event_paranoid

# Make it persistent
if ! grep -q "kernel.perf_event_paranoid" /etc/sysctl.conf; then
    echo "kernel.perf_event_paranoid=0" >> /etc/sysctl.conf
    echo "  Added to /etc/sysctl.conf"
else
    sed -i 's/kernel.perf_event_paranoid=.*/kernel.perf_event_paranoid=0/' /etc/sysctl.conf
    echo "  Updated /etc/sysctl.conf"
fi

echo -e "${GREEN}  Done${NC}"

echo -e "${YELLOW}[2/4] Installing dependencies...${NC}"

# Detect package manager
if command -v apt-get &> /dev/null; then
    apt-get update -qq
    apt-get install -y -qq \
        linux-tools-generic \
        linux-tools-$(uname -r) 2>/dev/null || apt-get install -y -qq linux-tools-aws 2>/dev/null || true
    apt-get install -y -qq \
        clang \
        llvm-dev \
        cmake \
        ninja-build \
        bc \
        jq \
        git \
        libzstd-dev \
        libcurl4-openssl-dev
elif command -v dnf &> /dev/null; then
    dnf install -y \
        perf \
        clang \
        llvm-devel \
        cmake \
        ninja-build \
        bc \
        jq \
        git
elif command -v yum &> /dev/null; then
    yum install -y \
        perf \
        clang \
        llvm-devel \
        cmake \
        ninja-build \
        bc \
        jq \
        git
else
    echo -e "${RED}Error: No supported package manager found (apt/dnf/yum)${NC}"
    exit 1
fi

echo -e "${GREEN}  Done${NC}"

echo -e "${YELLOW}[3/4] Verifying perf access...${NC}"

# Test perf as a non-root user (if possible)
if sudo -u nobody perf stat true 2>/dev/null; then
    echo -e "${GREEN}  perf works for non-root users${NC}"
else
    # Try as current user
    if perf stat true 2>/dev/null; then
        echo -e "${GREEN}  perf works${NC}"
    else
        echo -e "${RED}  perf failed - check kernel configuration${NC}"
        exit 1
    fi
fi

echo -e "${YELLOW}[4/4] System information...${NC}"

CPU_MODEL=$(lscpu | grep "Model name" | cut -d: -f2 | xargs)
KERNEL=$(uname -r)
PERF_VERSION=$(perf --version 2>/dev/null | head -1 || echo "unknown")

echo "  CPU: $CPU_MODEL"
echo "  Kernel: $KERNEL"
echo "  Perf: $PERF_VERSION"

echo ""
echo -e "${GREEN}=== Setup Complete ===${NC}"
echo ""
echo "Next steps:"
echo "  1. Clone Cache Explorer: git clone <repo>"
echo "  2. Build: ./scripts/build.sh"
echo "  3. Run validation: ./validation/validate-hardware.sh --update-baseline"
echo ""
echo "For GitHub Actions self-hosted runner:"
echo "  1. Go to repo Settings > Actions > Runners"
echo "  2. Add new self-hosted runner (Linux)"
echo "  3. Add labels: linux, perf"
echo ""
