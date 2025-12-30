# Cache Explorer Deployment Design

**Date:** 2024-12-30
**Status:** Ready for implementation
**Target:** Production deployment with sandboxed code execution

## Overview

Deploy Cache Explorer as a production service similar to Compiler Explorer. Users submit C/C++/Rust code via web UI, which gets compiled and analyzed in isolated Docker containers on a dedicated server.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼
┌───────────────┐    ┌───────────────────┐
│   Cloudflare  │    │     Hetzner       │
│     Pages     │    │   CX31 (~$15/mo)  │
│               │    │                   │
│  Static React │◄───│  Node.js Server   │
│   Frontend    │ WS │       │           │
│               │    │       ▼           │
└───────────────┘    │  Docker Sandboxes │
                     │                   │
                     └───────────────────┘
```

### Components

**Frontend (Cloudflare Pages)**
- Static React/TypeScript app
- Auto-deploys from GitHub
- Free tier, global CDN
- Custom domain: cache-explorer.dev

**Backend (Hetzner CX31)**
- 4 vCPU, 8GB RAM, 80GB SSD
- Ubuntu 22.04 LTS
- Node.js WebSocket server
- Docker for sandboxed execution
- Nginx reverse proxy + SSL

**Sandbox (Docker)**
- Pre-built image with LLVM 18
- Strict resource limits
- Network isolation
- Read-only filesystem

## Security Model

### Container Isolation

Each code submission runs in a fresh container with:

```yaml
resources:
  memory: 256MB          # Hard limit, OOM kill
  cpu: 1 core            # CPU quota
  pids: 50               # Process limit (prevents fork bombs)

timeouts:
  compile: 30s           # Compilation timeout
  execute: 10s           # Runtime timeout
  total: 45s             # Hard kill deadline

security:
  network: none          # No internet access
  read_only: true        # Immutable filesystem
  no_new_privileges: true
  seccomp: default       # Syscall filtering
  user: nobody           # Non-root
  cap_drop: ALL          # No capabilities
```

### Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Fork bomb | `--pids-limit=50` |
| Memory exhaustion | `--memory=256m` |
| CPU hogging | `--cpus=1` + timeout |
| Network attacks | `--network=none` |
| Filesystem escape | `--read-only` + tmpfs |
| Privilege escalation | `--no-new-privileges` + `--cap-drop=ALL` |
| Infinite loops | 10s execution timeout |
| Large output spam | Truncate stdout/stderr to 1MB |

## Docker Image

```dockerfile
FROM ubuntu:22.04

# Install LLVM 18
RUN apt-get update && apt-get install -y \
    clang-18 llvm-18-dev lld-18 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/clang-18 /usr/bin/clang \
    && ln -s /usr/bin/clang++-18 /usr/bin/clang++

# Copy Cache Explorer components
COPY CacheProfiler.so /opt/cache-explorer/
COPY libcache-explorer-rt.a /opt/cache-explorer/
COPY cache-sim /opt/cache-explorer/
COPY run.sh /opt/cache-explorer/

# Make binaries executable
RUN chmod +x /opt/cache-explorer/cache-sim /opt/cache-explorer/run.sh

# Non-root user
USER nobody
WORKDIR /tmp

ENTRYPOINT ["/opt/cache-explorer/run.sh"]
```

## Sandbox Entrypoint Script

```bash
#!/bin/bash
# /opt/cache-explorer/run.sh

set -e

CODE_FILE="$1"
CONFIG="${2:-intel}"
OPT_LEVEL="${3:--O0}"
OUTPUT_FORMAT="${4:-json}"

PASS="/opt/cache-explorer/CacheProfiler.so"
RT="/opt/cache-explorer/libcache-explorer-rt.a"
SIM="/opt/cache-explorer/cache-sim"

# Compile with instrumentation
clang $OPT_LEVEL -fpass-plugin="$PASS" \
    "$CODE_FILE" "$RT" \
    -o /tmp/instrumented \
    -lpthread 2>&1

# Run and capture trace
export CACHE_EXPLORER_OUTPUT=/tmp/trace.bin
timeout 10s /tmp/instrumented 2>&1 || true

# Simulate cache behavior
if [ -f /tmp/trace.bin ]; then
    $SIM --config "$CONFIG" --format "$OUTPUT_FORMAT" /tmp/trace.bin
else
    echo '{"error": "No trace generated"}'
fi
```

## Server Integration

### Docker Execution Module

```javascript
// backend/server/docker-runner.js

const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

const DOCKER_IMAGE = 'cache-explorer-sandbox';
const TEMP_DIR = '/opt/cache-explorer/data/tmp';

const LIMITS = {
  memory: '256m',
  cpus: '1',
  pidsLimit: 50,
  timeout: 45000, // ms
};

async function runInSandbox(code, options = {}) {
  const {
    config = 'intel',
    optLevel = '-O0',
    language = 'c',
  } = options;

  const id = uuidv4();
  const ext = language === 'cpp' ? '.cpp' : language === 'rust' ? '.rs' : '.c';
  const codeFile = path.join(TEMP_DIR, `${id}${ext}`);

  try {
    // Write code to temp file
    await fs.writeFile(codeFile, code);

    // Run in Docker
    const result = await new Promise((resolve, reject) => {
      const args = [
        'run', '--rm',
        '--memory', LIMITS.memory,
        '--cpus', LIMITS.cpus,
        '--pids-limit', String(LIMITS.pidsLimit),
        '--network', 'none',
        '--read-only',
        '--tmpfs', '/tmp:size=64m',
        '--no-new-privileges',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '-v', `${codeFile}:/tmp/code${ext}:ro`,
        DOCKER_IMAGE,
        `/tmp/code${ext}`, config, optLevel, 'json'
      ];

      const docker = spawn('docker', args);
      let stdout = '';
      let stderr = '';

      docker.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > 1024 * 1024) {
          docker.kill();
          reject(new Error('Output too large'));
        }
      });

      docker.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        docker.kill();
        reject(new Error('Execution timeout'));
      }, LIMITS.timeout);

      docker.on('close', (code) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode: code });
      });

      docker.on('error', reject);
    });

    return result;

  } finally {
    // Cleanup temp file
    await fs.unlink(codeFile).catch(() => {});
  }
}

module.exports = { runInSandbox };
```

## Deployment Steps

### Phase 1: Sandboxing (Day 1-2)

1. Create `docker/Dockerfile` for sandbox image
2. Create `docker/run.sh` entrypoint script
3. Create `backend/server/docker-runner.js` module
4. Integrate with existing WebSocket handler
5. Test with malicious inputs locally

### Phase 2: Server Setup (Day 2-3)

1. Provision Hetzner CX31 server
2. Run server setup script:
   ```bash
   # Install dependencies
   apt update && apt install -y docker.io nginx certbot nodejs npm

   # Configure firewall
   ufw allow 22,80,443/tcp
   ufw enable

   # Clone repo
   git clone https://github.com/user/cache-explorer /opt/cache-explorer

   # Build sandbox image
   cd /opt/cache-explorer/docker
   docker build -t cache-explorer-sandbox .

   # Install server deps
   cd /opt/cache-explorer/backend/server
   npm install
   ```

3. Configure Nginx (`/etc/nginx/sites-available/cache-explorer`):
   ```nginx
   server {
       listen 80;
       server_name api.cache-explorer.dev;
       return 301 https://$server_name$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name api.cache-explorer.dev;

       ssl_certificate /etc/letsencrypt/live/api.cache-explorer.dev/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/api.cache-explorer.dev/privkey.pem;

       location / {
           proxy_pass http://127.0.0.1:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_read_timeout 300s;
       }
   }
   ```

4. Create systemd service (`/etc/systemd/system/cache-explorer.service`):
   ```ini
   [Unit]
   Description=Cache Explorer Server
   After=network.target docker.service

   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/opt/cache-explorer/backend/server
   ExecStart=/usr/bin/node server.js
   Restart=always
   Environment=NODE_ENV=production
   Environment=PORT=3001

   [Install]
   WantedBy=multi-user.target
   ```

5. Start services:
   ```bash
   systemctl enable --now cache-explorer
   certbot --nginx -d api.cache-explorer.dev
   ```

### Phase 3: Frontend Deployment (Day 3)

1. Create Cloudflare Pages project
2. Connect GitHub repository
3. Configure build:
   - Build command: `cd frontend && npm install && npm run build`
   - Output directory: `frontend/dist`
   - Environment variable: `VITE_API_URL=https://api.cache-explorer.dev`
4. Set up custom domain

### Phase 4: CI/CD (Day 3-4)

GitHub Actions workflow (`.github/workflows/deploy.yml`):

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/cache-explorer
            git pull origin main
            cd docker && docker build -t cache-explorer-sandbox .
            cd ../backend/server && npm install
            sudo systemctl restart cache-explorer
```

### Phase 5: Launch (Day 4-5)

1. Write launch blog post
2. Create demo GIF
3. Test all examples
4. Set up uptime monitoring
5. Submit to HN/Reddit

## Cost Summary

| Item | Monthly Cost |
|------|--------------|
| Hetzner CX31 | ~$15 |
| Domain (annual/12) | ~$1 |
| Cloudflare Pages | Free |
| **Total** | **~$16/mo** |

## Success Criteria

- [ ] Sandbox blocks fork bombs, infinite loops, network access
- [ ] End-to-end latency <5s for simple programs
- [ ] Handles 10 concurrent users without degradation
- [ ] Zero security incidents in first month
- [ ] 100+ unique visitors in first week after launch
