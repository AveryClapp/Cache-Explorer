import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { initVimMode } from 'monaco-vim'
import LZString from 'lz-string'
import './App.css'

// API base URL - in production (Docker), use relative paths; in dev, use localhost
const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001'
const WS_URL = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
  : 'ws://localhost:3001/ws'

interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks: number
}

interface HotLine {
  file: string
  line: number
  hits: number
  misses: number
  missRate: number
  threads?: number
}

interface FalseSharingAccess {
  threadId: number
  offset: number
  isWrite: boolean
  file: string
  line: number
  count: number
}

interface FalseSharingEvent {
  cacheLineAddr: string
  accessCount: number
  accesses: FalseSharingAccess[]
}

interface CoherenceStats {
  invalidations: number
  falseSharingEvents: number
}

interface CompileError {
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
  suggestion?: string
  notes?: string[]
  sourceLine?: string
  caret?: string
}

interface ErrorResult {
  type: 'compile_error' | 'linker_error' | 'runtime_error' | 'timeout' | 'unknown_error' | 'validation_error' | 'server_error'
  errors?: CompileError[]
  summary?: string
  message?: string
  suggestion?: string
  raw?: string
  error?: string
}

interface OptimizationSuggestion {
  type: string
  severity: 'high' | 'medium' | 'low'
  location: string
  message: string
  fix: string
}

interface CacheLevelConfig {
  sizeKB: number
  assoc: number
  lineSize: number
  sets: number
}

interface CacheConfig {
  l1d: CacheLevelConfig
  l1i: CacheLevelConfig
  l2: CacheLevelConfig
  l3: CacheLevelConfig
}

// Timeline event from streaming progress
interface TimelineEvent {
  i: number       // event index
  t: 'R' | 'W' | 'I'  // type: Read, Write, Instruction fetch
  l: 1 | 2 | 3 | 4    // hit level: 1=L1, 2=L2, 3=L3, 4=memory
  a?: number      // memory address (for cache visualization)
  f?: string      // file (optional)
  n?: number      // line number (optional)
}

interface PrefetchStats {
  policy: string
  degree: number
  issued: number
  useful: number
  accuracy: number
}

interface CacheResult {
  config: string
  events: number
  multicore?: boolean
  cores?: number
  threads?: number
  cacheConfig?: CacheConfig
  levels: {
    l1?: CacheStats
    l1d?: CacheStats
    l1i?: CacheStats
    l2: CacheStats
    l3: CacheStats
  }
  coherence?: CoherenceStats
  hotLines: HotLine[]
  falseSharing?: FalseSharingEvent[]
  suggestions?: OptimizationSuggestion[]
  timeline?: TimelineEvent[]  // collected timeline events
  prefetch?: PrefetchStats
}

type Language = 'c' | 'cpp' | 'rust'

interface Example {
  name: string
  code: string
  description: string
  language: Language
}

const EXAMPLES: Record<string, Example> = {
  matrix: {
    name: 'Matrix Traversal',
    description: 'Row-major vs column-major',
    language: 'c',
    code: `#include <stdio.h>

#ifndef N
#define N 100
#endif

int main() {
    int matrix[N][N];

    // Row-major (cache-friendly)
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            matrix[i][j] = i + j;

    // Column-major (cache-unfriendly)
    int sum = 0;
    for (int j = 0; j < N; j++)
        for (int i = 0; i < N; i++)
            sum += matrix[i][j];

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  sequential: {
    name: 'Sequential Access',
    description: 'Best case - spatial locality',
    language: 'c',
    code: `#include <stdio.h>

#ifndef N
#define N 1000
#endif

int main() {
    int arr[N];
    int sum = 0;

    for (int i = 0; i < N; i++) arr[i] = i;
    for (int i = 0; i < N; i++) sum += arr[i];

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  strided: {
    name: 'Strided Access',
    description: 'Worst case - skips cache lines',
    language: 'c',
    code: `#include <stdio.h>

#ifndef N
#define N 1000
#endif

#ifndef STRIDE
#define STRIDE 16  // 64 bytes = 1 cache line
#endif

int main() {
    int arr[N * STRIDE];
    for (int i = 0; i < N * STRIDE; i++) arr[i] = i;

    int sum = 0;
    for (int i = 0; i < N; i++)
        sum += arr[i * STRIDE];  // Miss every time!

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  blocking: {
    name: 'Cache Blocking',
    description: 'Matrix multiply optimization',
    language: 'c',
    code: `#include <stdio.h>

#ifndef N
#define N 64
#endif

#ifndef BLOCK
#define BLOCK 8
#endif

int A[N][N], B[N][N], C[N][N];

int main() {
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            A[i][j] = i + j;
            B[i][j] = i - j;
            C[i][j] = 0;
        }

    // Blocked multiply - better cache reuse
    for (int ii = 0; ii < N; ii += BLOCK)
        for (int jj = 0; jj < N; jj += BLOCK)
            for (int kk = 0; kk < N; kk += BLOCK)
                for (int i = ii; i < ii + BLOCK && i < N; i++)
                    for (int j = jj; j < jj + BLOCK && j < N; j++) {
                        int sum = C[i][j];
                        for (int k = kk; k < kk + BLOCK && k < N; k++)
                            sum += A[i][k] * B[k][j];
                        C[i][j] = sum;
                    }

    printf("C[0][0] = %d\\n", C[0][0]);
    return 0;
}
`
  },
  linkedlist: {
    name: 'Linked List',
    description: 'Pointer chasing - poor locality',
    language: 'c',
    code: `#include <stdio.h>
#include <stdlib.h>

#ifndef N
#define N 1000
#endif

struct Node { int value; struct Node* next; };

int main() {
    struct Node* head = NULL;
    for (int i = 0; i < N; i++) {
        struct Node* n = malloc(sizeof(struct Node));
        n->value = i;
        n->next = head;
        head = n;
    }

    int sum = 0;
    for (struct Node* c = head; c; c = c->next)
        sum += c->value;

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  // C++ Examples (using C-compatible constructs for ARM64 compatibility)
  cpp_struct: {
    name: 'C++ Structs',
    description: 'Struct layout and cache behavior',
    language: 'cpp',
    code: `#ifndef N
#define N 1000
#endif

struct Point {
    float x, y, z;  // 12 bytes
};

Point points[N];
float result;

int main() {
    // Initialize - sequential access
    for (int i = 0; i < N; i++) {
        points[i].x = (float)i;
        points[i].y = (float)i * 2;
        points[i].z = (float)i * 3;
    }

    // Access pattern matters for cache
    float total = 0;
    for (int i = 0; i < N; i++) {
        Point& p = points[i];
        total += p.x * p.x + p.y * p.y + p.z * p.z;
    }

    result = total;
    return 0;
}
`
  },
  aos_vs_soa: {
    name: 'AoS vs SoA',
    description: 'Array of Structs vs Struct of Arrays',
    language: 'cpp',
    code: `#ifndef N
#define N 1000
#endif

// Array of Structs - poor cache use for single field
struct ParticleAoS {
    float x, y, z;
    float vx, vy, vz;
    float mass;
    int id;  // 32 bytes total
};

// Struct of Arrays - better for field-wise access
float soa_x[N], soa_y[N], soa_z[N];
float soa_mass[N];

ParticleAoS aos[N];
float result_aos, result_soa;

int main() {
    // Initialize both layouts
    for (int i = 0; i < N; i++) {
        aos[i].x = aos[i].y = aos[i].z = (float)i;
        aos[i].mass = 1.0f;
        soa_x[i] = soa_y[i] = soa_z[i] = (float)i;
        soa_mass[i] = 1.0f;
    }

    // AoS: loads 32 bytes per element, uses only 4
    float sum_aos = 0;
    for (int i = 0; i < N; i++)
        sum_aos += aos[i].x;

    // SoA: contiguous x values, perfect cache use
    float sum_soa = 0;
    for (int i = 0; i < N; i++)
        sum_soa += soa_x[i];

    result_aos = sum_aos;
    result_soa = sum_soa;
    return 0;
}
`
  },
  cpp_template: {
    name: 'Template Array',
    description: 'Simple template with cache behavior',
    language: 'cpp',
    code: `#ifndef N
#define N 1000
#endif

template<typename T, int Size>
struct Array {
    T data[Size];
    T& operator[](int i) { return data[i]; }
};

Array<int, N> arr;
int result;

int main() {
    // Write sequentially
    for (int i = 0; i < N; i++)
        arr[i] = i;

    // Read sequentially - cache friendly
    int sum = 0;
    for (int i = 0; i < N; i++)
        sum += arr[i];

    result = sum;
    return 0;
}
`
  },
}

const EXAMPLE_CODE = EXAMPLES.matrix.code

function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

function CacheBar({ result, sampled }: { result: CacheResult; sampled?: boolean }) {
  const l1d = result.levels.l1d || result.levels.l1!
  const l1i = result.levels.l1i
  const l2 = result.levels.l2
  const l3 = result.levels.l3

  const getClass = (rate: number) => rate > 0.95 ? 'excellent' : rate > 0.9 ? 'good' : rate > 0.7 ? 'ok' : 'bad'

  return (
    <div className="cache-bar">
      <div className={`cache-item ${getClass(l1d.hitRate)}`} title={`${l1d.hits.toLocaleString()} hits, ${l1d.misses.toLocaleString()} misses`}>
        <span className="cache-label">L1d</span>
        <span className="cache-rate">{formatPercent(l1d.hitRate)}</span>
      </div>
      {l1i && (
        <div className={`cache-item ${getClass(l1i.hitRate)}`} title={`${l1i.hits.toLocaleString()} hits, ${l1i.misses.toLocaleString()} misses`}>
          <span className="cache-label">L1i</span>
          <span className="cache-rate">{formatPercent(l1i.hitRate)}</span>
        </div>
      )}
      <div className={`cache-item ${getClass(l2.hitRate)}`} title={`${l2.hits.toLocaleString()} hits, ${l2.misses.toLocaleString()} misses`}>
        <span className="cache-label">L2</span>
        <span className="cache-rate">{formatPercent(l2.hitRate)}</span>
      </div>
      <div className={`cache-item ${getClass(l3.hitRate)}`} title={`${l3.hits.toLocaleString()} hits, ${l3.misses.toLocaleString()} misses`}>
        <span className="cache-label">L3</span>
        <span className="cache-rate">{formatPercent(l3.hitRate)}</span>
      </div>
      <div className="cache-item events" title={sampled ? 'Sampled - actual count may be higher' : 'Total memory access events'}>
        <span className="cache-label">{sampled ? 'Sampled' : 'Events'}</span>
        <span className="cache-rate">{result.events.toLocaleString()}</span>
      </div>
    </div>
  )
}

function LevelDetail({ name, stats }: { name: string; stats: CacheStats }) {
  return (
    <div className="level-detail">
      <div className="level-header">{name}</div>
      <div className="level-row">
        <span>Hits</span>
        <span className="mono">{stats.hits.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Misses</span>
        <span className="mono">{stats.misses.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Hit Rate</span>
        <span className={`mono ${stats.hitRate > 0.9 ? 'good' : stats.hitRate > 0.7 ? 'ok' : 'bad'}`}>
          {formatPercent(stats.hitRate)}
        </span>
      </div>
    </div>
  )
}

// Cache line state for visualization
interface CacheLine {
  valid: boolean
  tag: number
  dirty: boolean
  lastAccess: number  // event index when last accessed
  accessCount: number
}

// Interactive cache grid with timeline scrubber
function InteractiveCacheGrid({
  config,
  timeline,
  currentIndex,
  onIndexChange
}: {
  config: CacheLevelConfig
  timeline: TimelineEvent[]
  currentIndex: number
  onIndexChange: (idx: number) => void
}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(10)  // events per second
  const playRef = useRef<number | null>(null)

  // Compute cache state up to currentIndex
  const cacheState = useMemo(() => {
    const numSets = config.sets
    const assoc = config.assoc
    const lineSize = config.lineSize

    // Initialize empty cache
    const cache: CacheLine[][] = Array.from({ length: numSets }, () =>
      Array.from({ length: assoc }, () => ({
        valid: false,
        tag: 0,
        dirty: false,
        lastAccess: -1,
        accessCount: 0
      }))
    )

    // LRU tracking per set
    const lruOrder: number[][] = Array.from({ length: numSets }, () =>
      Array.from({ length: assoc }, (_, i) => i)
    )

    // Process events up to currentIndex
    for (let i = 0; i < Math.min(currentIndex, timeline.length); i++) {
      const event = timeline[i]
      if (!event.a || event.t === 'I') continue  // Skip instruction fetches for L1D

      const addr = event.a
      const setIndex = Math.floor(addr / lineSize) % numSets
      const tag = Math.floor(addr / lineSize / numSets)
      const isWrite = event.t === 'W'

      const set = cache[setIndex]
      const lru = lruOrder[setIndex]

      // Check for hit
      let hitWay = -1
      for (let way = 0; way < assoc; way++) {
        if (set[way].valid && set[way].tag === tag) {
          hitWay = way
          break
        }
      }

      if (hitWay >= 0) {
        // Hit - update LRU and access info
        set[hitWay].lastAccess = i
        set[hitWay].accessCount++
        if (isWrite) set[hitWay].dirty = true

        // Move to MRU position
        const idx = lru.indexOf(hitWay)
        lru.splice(idx, 1)
        lru.push(hitWay)
      } else {
        // Miss - find victim (LRU) and replace
        const victimWay = lru[0]
        set[victimWay] = {
          valid: true,
          tag,
          dirty: isWrite,
          lastAccess: i,
          accessCount: 1
        }

        // Move to MRU position
        lru.shift()
        lru.push(victimWay)
      }
    }

    return cache
  }, [config, timeline, currentIndex])

  // Playback control
  useEffect(() => {
    if (isPlaying && currentIndex < timeline.length) {
      playRef.current = window.setInterval(() => {
        onIndexChange(Math.min(currentIndex + 1, timeline.length))
      }, 1000 / playSpeed)
    }
    return () => {
      if (playRef.current) {
        clearInterval(playRef.current)
        playRef.current = null
      }
    }
  }, [isPlaying, currentIndex, timeline.length, playSpeed, onIndexChange])

  // Stop playing when reaching end
  useEffect(() => {
    if (currentIndex >= timeline.length) {
      setIsPlaying(false)
    }
  }, [currentIndex, timeline.length])

  const getHeatColor = (line: CacheLine, maxIndex: number) => {
    if (!line.valid) return 'empty'
    const recency = maxIndex > 0 ? (line.lastAccess / maxIndex) : 0
    if (recency > 0.9) return 'hot'
    if (recency > 0.5) return 'warm'
    if (recency > 0.1) return 'cool'
    return 'cold'
  }

  const currentEvent = timeline[currentIndex - 1]
  const currentSet = currentEvent?.a
    ? Math.floor(currentEvent.a / config.lineSize) % config.sets
    : -1

  return (
    <div className="interactive-cache-grid">
      <div className="cache-grid-header">
        <div className="cache-grid-title">
          L1D Cache State ({config.sets} sets × {config.assoc} ways)
        </div>
        <div className="scrubber-controls">
          <button
            className="play-btn"
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={currentIndex >= timeline.length}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            className="step-btn"
            onClick={() => onIndexChange(Math.max(0, currentIndex - 1))}
            disabled={currentIndex <= 0}
          >
            ◀
          </button>
          <button
            className="step-btn"
            onClick={() => onIndexChange(Math.min(timeline.length, currentIndex + 1))}
            disabled={currentIndex >= timeline.length}
          >
            ▶
          </button>
          <select
            className="speed-select"
            value={playSpeed}
            onChange={(e) => setPlaySpeed(Number(e.target.value))}
          >
            <option value={1}>1x</option>
            <option value={5}>5x</option>
            <option value={10}>10x</option>
            <option value={50}>50x</option>
            <option value={100}>100x</option>
          </select>
        </div>
      </div>

      {/* Timeline scrubber */}
      <div className="timeline-scrubber">
        <input
          type="range"
          min={0}
          max={timeline.length}
          value={currentIndex}
          onChange={(e) => onIndexChange(Number(e.target.value))}
          className="scrubber-slider"
        />
        <div className="scrubber-info">
          <span>Event {currentIndex} / {timeline.length}</span>
          {currentEvent && (
            <span className="current-event-info">
              {currentEvent.t === 'R' ? 'Read' : currentEvent.t === 'W' ? 'Write' : 'Fetch'}
              {currentEvent.l === 1 ? ' → L1 Hit' : currentEvent.l === 2 ? ' → L2 Hit' : currentEvent.l === 3 ? ' → L3 Hit' : ' → Memory'}
              {currentSet >= 0 && ` (Set ${currentSet})`}
            </span>
          )}
        </div>
      </div>

      {/* Cache grid */}
      <div className="cache-grid animated">
        <div className="grid-header">
          <div className="grid-corner">Set</div>
          {Array.from({ length: config.assoc }, (_, i) => (
            <div key={i} className="grid-way-label">W{i}</div>
          ))}
        </div>
        {Array.from({ length: Math.min(config.sets, 16) }, (_, setIdx) => (
          <div
            key={setIdx}
            className={`grid-row ${setIdx === currentSet ? 'active-set' : ''}`}
          >
            <div className="grid-set-label">{setIdx}</div>
            {cacheState[setIdx].map((line: CacheLine, wayIdx: number) => (
              <div
                key={wayIdx}
                className={`grid-cell ${getHeatColor(line, currentIndex)} ${line.dirty ? 'dirty' : ''}`}
                title={line.valid
                  ? `Tag: 0x${line.tag.toString(16)}\nAccesses: ${line.accessCount}\nLast: #${line.lastAccess}${line.dirty ? '\n(dirty)' : ''}`
                  : 'Empty'
                }
              >
                {line.valid && (
                  <span className="cell-tag">
                    {line.accessCount > 1 ? line.accessCount : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
        {config.sets > 16 && (
          <div className="grid-ellipsis">... {config.sets - 16} more sets</div>
        )}
      </div>

      <div className="cache-grid-legend">
        <span className="legend-item"><span className="legend-color empty" /> Empty</span>
        <span className="legend-item"><span className="legend-color cold" /> Cold</span>
        <span className="legend-item"><span className="legend-color cool" /> Cool</span>
        <span className="legend-item"><span className="legend-color warm" /> Warm</span>
        <span className="legend-item"><span className="legend-color hot" /> Hot</span>
        <span className="legend-item"><span className="legend-color dirty" /> Dirty</span>
      </div>
    </div>
  )
}

// False Sharing Visualization Component
function FalseSharingViz({ falseSharing, lineSize = 64 }: {
  falseSharing: FalseSharingEvent[]
  lineSize?: number
}) {
  if (!falseSharing || falseSharing.length === 0) return null

  // Get unique thread IDs for color assignment
  const threadColors: Record<number, string> = {}
  const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e']
  let colorIdx = 0

  falseSharing.forEach(fs => {
    fs.accesses.forEach(a => {
      if (!(a.threadId in threadColors)) {
        threadColors[a.threadId] = colors[colorIdx % colors.length]
        colorIdx++
      }
    })
  })

  return (
    <div className="false-sharing-viz">
      <div className="section-title">False Sharing Details</div>
      <p className="viz-description">
        Multiple threads accessing different bytes in the same {lineSize}-byte cache line.
        This causes cache invalidations and performance loss.
      </p>

      {falseSharing.slice(0, 5).map((fs, idx) => {
        // Build byte access map
        const byteAccess: { threadId: number; isWrite: boolean; count: number }[] = Array(lineSize).fill(null)

        fs.accesses.forEach(a => {
          const offset = a.offset % lineSize
          if (!byteAccess[offset]) {
            byteAccess[offset] = { threadId: a.threadId, isWrite: a.isWrite, count: a.count }
          } else {
            byteAccess[offset].count += a.count
          }
        })

        // Get unique threads for this cache line
        const threads = [...new Set(fs.accesses.map(a => a.threadId))]

        return (
          <div key={idx} className="cache-line-viz">
            <div className="cache-line-header">
              <code>Cache Line {fs.cacheLineAddr}</code>
              <span className="access-count">{fs.accessCount.toLocaleString()} accesses</span>
            </div>

            <div className="byte-grid" style={{ gridTemplateColumns: `repeat(${Math.min(lineSize, 32)}, 1fr)` }}>
              {byteAccess.slice(0, Math.min(lineSize, 32)).map((access, byteIdx) => (
                <div
                  key={byteIdx}
                  className={`byte-cell ${access ? (access.isWrite ? 'write' : 'read') : 'unused'}`}
                  style={access ? { backgroundColor: threadColors[access.threadId] } : undefined}
                  title={access ? `Thread ${access.threadId}: ${access.count} ${access.isWrite ? 'writes' : 'reads'} at offset ${byteIdx}` : `Byte ${byteIdx}`}
                />
              ))}
            </div>
            {lineSize > 32 && <div className="byte-ellipsis">... {lineSize - 32} more bytes</div>}

            <div className="thread-legend">
              {threads.map(tid => (
                <span key={tid} className="thread-tag" style={{ backgroundColor: threadColors[tid] }}>
                  Thread {tid}
                </span>
              ))}
            </div>

            <div className="access-details">
              {fs.accesses.slice(0, 4).map((a, i) => (
                <div key={i} className="access-item">
                  <span className="thread-dot" style={{ backgroundColor: threadColors[a.threadId] }} />
                  <code>{a.file}:{a.line}</code>
                  <span className="access-type">{a.isWrite ? 'W' : 'R'}</span>
                  <span className="access-offset">+{a.offset}</span>
                </div>
              ))}
              {fs.accesses.length > 4 && (
                <div className="access-more">... and {fs.accesses.length - 4} more</div>
              )}
            </div>
          </div>
        )
      })}

      {falseSharing.length > 5 && (
        <div className="more-events">... {falseSharing.length - 5} more false sharing events</div>
      )}

      <div className="fix-suggestion">
        <strong>Fix:</strong> Add padding between fields accessed by different threads to ensure they're on separate cache lines.
        For a {lineSize}-byte line, add at least {lineSize} bytes of padding.
      </div>
    </div>
  )
}

function CacheHierarchyViz({ result, timeline, scrubberIndex, onScrubberChange }: {
  result: CacheResult
  timeline?: TimelineEvent[]
  scrubberIndex?: number
  onScrubberChange?: (idx: number) => void
}) {
  const config = result.cacheConfig
  const levels = result.levels

  const l1d = levels.l1d || levels.l1
  const l1i = levels.l1i
  const l2 = levels.l2
  const l3 = levels.l3

  if (!l1d) return null

  const formatSize = (kb: number) => {
    if (kb >= 1024) return `${kb / 1024} MB`
    return `${kb} KB`
  }

  const getHitRateClass = (rate: number) => {
    if (rate >= 0.95) return 'excellent'
    if (rate >= 0.8) return 'good'
    if (rate >= 0.5) return 'moderate'
    return 'poor'
  }

  const HitRateBar = ({ rate, label }: { rate: number; label: string }) => (
    <div className="hit-rate-bar">
      <div className="hit-rate-label">{label}</div>
      <div className="hit-rate-track">
        <div
          className={`hit-rate-fill ${getHitRateClass(rate)}`}
          style={{ width: `${rate * 100}%` }}
        />
      </div>
      <div className="hit-rate-value">{(rate * 100).toFixed(1)}%</div>
    </div>
  )

  return (
    <div className="cache-hierarchy-viz">
      <div className="hierarchy-title">Cache Hierarchy</div>

      <div className="hierarchy-diagram">
        {/* CPU Core */}
        <div className="hierarchy-level cpu">
          <div className="level-box cpu-box">
            <div className="box-label">CPU Core</div>
          </div>
        </div>

        {/* L1 Caches */}
        <div className="hierarchy-level l1">
          <div className={`level-box l1-box ${getHitRateClass(l1d.hitRate)}`}>
            <div className="box-label">L1 Data</div>
            {config && <div className="box-size">{formatSize(config.l1d.sizeKB)}</div>}
            <div className="box-stats">
              {l1d.hits} hits / {l1d.misses} misses
            </div>
          </div>
          {l1i && (
            <div className={`level-box l1-box ${getHitRateClass(l1i.hitRate)}`}>
              <div className="box-label">L1 Instr</div>
              {config && <div className="box-size">{formatSize(config.l1i.sizeKB)}</div>}
              <div className="box-stats">
                {l1i.hits} hits / {l1i.misses} misses
              </div>
            </div>
          )}
        </div>

        <div className="hierarchy-connector" />

        {/* L2 Cache */}
        <div className="hierarchy-level l2">
          <div className={`level-box l2-box ${getHitRateClass(l2.hitRate)}`}>
            <div className="box-label">L2 Unified</div>
            {config && <div className="box-size">{formatSize(config.l2.sizeKB)}</div>}
            <div className="box-stats">
              {l2.hits} hits / {l2.misses} misses
            </div>
          </div>
        </div>

        <div className="hierarchy-connector" />

        {/* L3 Cache */}
        <div className="hierarchy-level l3">
          <div className={`level-box l3-box ${getHitRateClass(l3.hitRate)}`}>
            <div className="box-label">L3 Shared</div>
            {config && <div className="box-size">{formatSize(config.l3.sizeKB)}</div>}
            <div className="box-stats">
              {l3.hits} hits / {l3.misses} misses
            </div>
          </div>
        </div>

        <div className="hierarchy-connector" />

        {/* Main Memory */}
        <div className="hierarchy-level memory">
          <div className="level-box memory-box">
            <div className="box-label">Main Memory</div>
            <div className="box-stats">{l3.misses} accesses</div>
          </div>
        </div>
      </div>

      {/* Hit Rate Bars */}
      <div className="hit-rates-section">
        <div className="hit-rates-title">Hit Rates</div>
        <HitRateBar rate={l1d.hitRate} label="L1 Data" />
        {l1i && <HitRateBar rate={l1i.hitRate} label="L1 Instr" />}
        <HitRateBar rate={l2.hitRate} label="L2" />
        <HitRateBar rate={l3.hitRate} label="L3" />
      </div>

      {/* Interactive Cache Grid with Timeline Scrubber */}
      {config && config.l1d.sets <= 32 && timeline && timeline.length > 0 && onScrubberChange && (
        <InteractiveCacheGrid
          config={config.l1d}
          timeline={timeline}
          currentIndex={scrubberIndex ?? timeline.length}
          onIndexChange={onScrubberChange}
        />
      )}

      {/* Static grid fallback when no timeline */}
      {config && config.l1d.sets <= 32 && (!timeline || timeline.length === 0) && (
        <div className="cache-grid-section">
          <div className="cache-grid-title">
            L1 Data Cache Structure ({config.l1d.sets} sets × {config.l1d.assoc} ways)
          </div>
          <div className="cache-grid">
            <div className="grid-header">
              <div className="grid-corner">Set</div>
              {Array.from({ length: config.l1d.assoc }, (_, i) => (
                <div key={i} className="grid-way-label">Way {i}</div>
              ))}
            </div>
            {Array.from({ length: Math.min(config.l1d.sets, 16) }, (_, setIdx) => (
              <div key={setIdx} className="grid-row">
                <div className="grid-set-label">{setIdx}</div>
                {Array.from({ length: config.l1d.assoc }, (_, wayIdx) => (
                  <div key={wayIdx} className="grid-cell" title={`Set ${setIdx}, Way ${wayIdx}`} />
                ))}
              </div>
            ))}
            {config.l1d.sets > 16 && (
              <div className="grid-ellipsis">... {config.l1d.sets - 16} more sets</div>
            )}
          </div>
          <div className="cache-grid-legend">
            <span className="legend-item"><span className="legend-color empty" /> Empty</span>
            <span className="legend-item"><span className="legend-color valid" /> Valid</span>
            <span className="legend-item"><span className="legend-color dirty" /> Dirty</span>
          </div>
        </div>
      )}
    </div>
  )
}

function AccessTimeline({ events, onEventClick }: { events: TimelineEvent[], onEventClick?: (line: number) => void }) {
  const maxEvents = 500  // Limit display for performance
  const displayEvents = events.slice(-maxEvents)

  const getLevelColor = (level: number) => {
    switch (level) {
      case 1: return 'level-l1'  // L1 hit - green
      case 2: return 'level-l2'  // L2 hit - yellow
      case 3: return 'level-l3'  // L3 hit - orange
      case 4: return 'level-mem' // Memory - red
      default: return 'level-mem'
    }
  }

  const getLevelName = (level: number) => {
    switch (level) {
      case 1: return 'L1'
      case 2: return 'L2'
      case 3: return 'L3'
      case 4: return 'Mem'
      default: return '?'
    }
  }

  const getTypeName = (type: string) => {
    switch (type) {
      case 'R': return 'Read'
      case 'W': return 'Write'
      case 'I': return 'Fetch'
      default: return type
    }
  }

  // Count events by level
  const counts = { l1: 0, l2: 0, l3: 0, mem: 0 }
  for (const e of events) {
    if (e.l === 1) counts.l1++
    else if (e.l === 2) counts.l2++
    else if (e.l === 3) counts.l3++
    else counts.mem++
  }

  return (
    <div className="access-timeline">
      <div className="timeline-header">
        <span className="timeline-title">Access Timeline</span>
        <span className="timeline-count">{events.length.toLocaleString()} events</span>
      </div>

      <div className="timeline-summary">
        <span className="timeline-stat level-l1">{counts.l1} L1</span>
        <span className="timeline-stat level-l2">{counts.l2} L2</span>
        <span className="timeline-stat level-l3">{counts.l3} L3</span>
        <span className="timeline-stat level-mem">{counts.mem} Mem</span>
      </div>

      <div className="timeline-strip">
        {displayEvents.map((e, idx) => (
          <div
            key={idx}
            className={`timeline-event ${getLevelColor(e.l)}`}
            title={`#${e.i}: ${getTypeName(e.t)} → ${getLevelName(e.l)}${e.f ? ` (${e.f}:${e.n})` : ''}`}
            onClick={() => e.n && onEventClick?.(e.n)}
          />
        ))}
      </div>

      <div className="timeline-legend">
        <span className="legend-item"><span className="legend-dot level-l1" /> L1 Hit</span>
        <span className="legend-item"><span className="legend-dot level-l2" /> L2 Hit</span>
        <span className="legend-item"><span className="legend-dot level-l3" /> L3 Hit</span>
        <span className="legend-item"><span className="legend-dot level-mem" /> Memory</span>
      </div>

      {events.length > maxEvents && (
        <div className="timeline-truncated">
          Showing last {maxEvents} of {events.length.toLocaleString()} events
        </div>
      )}
    </div>
  )
}

function ErrorDisplay({ error }: { error: ErrorResult }) {
  const titles: Record<string, string> = {
    compile_error: 'Compilation Failed',
    linker_error: 'Linker Error',
    runtime_error: 'Runtime Error',
    timeout: 'Timeout',
    unknown_error: 'Error',
    validation_error: 'Invalid Request',
    server_error: 'Server Error'
  }

  const icons: Record<string, string> = {
    compile_error: '\u2717',
    linker_error: '\u26D4',
    runtime_error: '\u26A0',
    timeout: '\u23F1',
    unknown_error: '\u2753',
    validation_error: '\u26A0',
    server_error: '\u26A0'
  }

  return (
    <div className="error-box">
      <div className="error-header">
        <span className="error-icon">{icons[error.type] || '\u2717'}</span>
        <span className="error-title">{titles[error.type] || 'Error'}</span>
        {error.summary && <span className="error-summary">{error.summary}</span>}
      </div>

      {error.errors?.map((e, i) => (
        <div key={i} className={`error-item ${e.severity}`}>
          <div className="error-item-header">
            <span className="error-loc">Line {e.line}:{e.column}</span>
            <span className={`error-severity ${e.severity}`}>{e.severity}</span>
          </div>
          <div className="error-msg">{e.message}</div>

          {e.sourceLine && (
            <pre className="error-source">
              <code>{e.sourceLine}</code>
              {e.caret && <code className="error-caret">{e.caret}</code>}
            </pre>
          )}

          {e.suggestion && (
            <div className="error-suggestion">
              <span className="suggestion-icon">{'\u{1F4A1}'}</span> {e.suggestion}
            </div>
          )}

          {e.notes && e.notes.length > 0 && (
            <div className="error-notes">
              {e.notes.map((note, j) => (
                <div key={j} className="error-note">\u2192 {note}</div>
              ))}
            </div>
          )}
        </div>
      ))}

      {error.message && (
        <div className="error-message-box">
          <div className="error-msg">{error.message}</div>
          {error.suggestion && (
            <div className="error-suggestion">
              <span className="suggestion-icon">{'\u{1F4A1}'}</span> {error.suggestion}
            </div>
          )}
        </div>
      )}

      {error.raw && <pre className="error-pre">{error.raw}</pre>}
      {error.error && <pre className="error-pre">{error.error}</pre>}
    </div>
  )
}

type Stage = 'idle' | 'connecting' | 'preparing' | 'compiling' | 'running' | 'processing' | 'done'

interface DefineEntry {
  name: string
  value: string
}

interface CustomCacheConfig {
  l1Size: number
  l1Assoc: number
  lineSize: number
  l2Size: number
  l2Assoc: number
  l3Size: number
  l3Assoc: number
}

const defaultCustomConfig: CustomCacheConfig = {
  l1Size: 32768,
  l1Assoc: 8,
  lineSize: 64,
  l2Size: 262144,
  l2Assoc: 8,
  l3Size: 8388608,
  l3Assoc: 16
}

interface ShareableState {
  code: string
  config: string
  optLevel: string
  language?: Language
  defines?: DefineEntry[]
}

function encodeState(state: ShareableState): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(state))
}

function decodeState(encoded: string): ShareableState | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded)
    if (!json) return null
    return JSON.parse(json)
  } catch {
    return null
  }
}

type PrefetchPolicy = 'none' | 'next' | 'stream' | 'stride' | 'adaptive'

// Default prefetch policies for hardware presets (based on real hardware behavior)
const PREFETCH_DEFAULTS: Record<string, PrefetchPolicy> = {
  // Intel uses aggressive stream prefetchers + adjacent line prefetcher
  intel: 'stream',
  intel14: 'stream',
  xeon: 'stream',
  // AMD Zen uses stride + stream detection
  amd: 'adaptive',
  zen3: 'adaptive',
  zen4: 'adaptive',
  epyc: 'adaptive',
  // Apple Silicon has very aggressive stream prefetchers
  apple: 'stream',
  m1: 'stream',
  m2: 'stream',
  m3: 'stream',
  // ARM uses stream prefetching
  graviton: 'stream',
  rpi4: 'next',
  // Embedded often has simple or no prefetching
  embedded: 'next',
  // Educational - no prefetch to show raw behavior
  educational: 'none',
  // Custom - user decides
  custom: 'none',
}

function App() {
  const [code, setCode] = useState(EXAMPLE_CODE)
  const [language, setLanguage] = useState<Language>('c')
  const [config, setConfig] = useState('educational')
  const [optLevel, setOptLevel] = useState('-O0')
  const [prefetchPolicy, setPrefetchPolicy] = useState<PrefetchPolicy>('none')
  const [result, setResult] = useState<CacheResult | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<ErrorResult | null>(null)
  const [customConfig, setCustomConfig] = useState<CustomCacheConfig>(defaultCustomConfig)
  const [defines, setDefines] = useState<DefineEntry[]>([])
  const [copied, setCopied] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [diffMode, setDiffMode] = useState(false)
  const [sampleRate, setSampleRate] = useState(1)  // 1 = no sampling
  const [eventLimit, setEventLimit] = useState(5000000)  // 5M default (~30s max runtime)
  const [longRunning, setLongRunning] = useState(false)
  const [baselineCode, setBaselineCode] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [scrubberIndex, setScrubberIndex] = useState<number>(0)  // For interactive cache grid
  const [vimMode, setVimMode] = useState(false)  // Vim keybindings toggle
  const timelineRef = useRef<TimelineEvent[]>([])  // Accumulator during streaming
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const decorationsRef = useRef<string[]>([])
  const optionsRef = useRef<HTMLDivElement>(null)
  const vimStatusRef = useRef<HTMLDivElement>(null)
  const vimModeRef = useRef<{ dispose: () => void } | null>(null)

  // Monaco language mapping
  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'rust' ? 'rust' : 'c'

  // Close options dropdown when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setShowOptions(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
  }

  // Vim mode initialization
  useEffect(() => {
    if (vimMode && editorRef.current && vimStatusRef.current) {
      // Initialize vim mode
      vimModeRef.current = initVimMode(editorRef.current, vimStatusRef.current)
    } else if (vimModeRef.current) {
      // Cleanup vim mode
      vimModeRef.current.dispose()
      vimModeRef.current = null
    }
    return () => {
      if (vimModeRef.current) {
        vimModeRef.current.dispose()
        vimModeRef.current = null
      }
    }
  }, [vimMode])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Enter to run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (stage === 'idle') runAnalysis()
      }
      // Escape to close dropdown
      if (e.key === 'Escape') {
        setShowOptions(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  // Load state from URL on mount
  useEffect(() => {
    const loadState = async () => {
      const params = new URLSearchParams(window.location.search)
      const shortId = params.get('s')

      if (shortId) {
        try {
          const response = await fetch(`${API_BASE}/s/${shortId}`)
          const data = await response.json()
          if (data.state) {
            setCode(data.state.code)
            setConfig(data.state.config)
            setOptLevel(data.state.optLevel)
            if (data.state.language) setLanguage(data.state.language)
            if (data.state.defines) setDefines(data.state.defines)
            return
          }
        } catch { /* ignore */ }
      }

      const hash = window.location.hash.slice(1)
      if (hash) {
        const saved = decodeState(hash)
        if (saved) {
          setCode(saved.code)
          setConfig(saved.config)
          setOptLevel(saved.optLevel)
          if (saved.language) setLanguage(saved.language)
          if (saved.defines) setDefines(saved.defines)
        }
      }
    }
    loadState()
  }, [])

  // Update URL when state changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const encoded = encodeState({ code, config, optLevel, language, defines })
      window.history.replaceState(null, '', `${window.location.pathname}#${encoded}`)
    }, 500)
    return () => clearTimeout(timer)
  }, [code, config, optLevel, language, defines])

  const handleShare = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/shorten`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: { code, config, optLevel, language, defines } }),
      })
      const data = await response.json()
      if (data.id) {
        const url = `${window.location.origin}${window.location.pathname}?s=${data.id}`
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [code, config, optLevel, language, defines])

  // Apply error markers (red squiggles) for compile errors
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return

    const monaco = monacoRef.current
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    // Clear existing markers
    monaco.editor.setModelMarkers(model, 'cache-explorer', [])

    if (!error || !error.errors || error.errors.length === 0) return

    // Create markers for each error
    const markers: editor.IMarkerData[] = error.errors.map(err => ({
      severity: err.severity === 'error'
        ? monaco.MarkerSeverity.Error
        : monaco.MarkerSeverity.Warning,
      message: err.message + (err.suggestion ? `\n\n💡 ${err.suggestion}` : ''),
      startLineNumber: err.line,
      startColumn: err.column,
      endLineNumber: err.line,
      // Estimate end column: find the end of the problematic token/line
      endColumn: err.column + (err.sourceLine
        ? Math.min(20, err.sourceLine.length - err.column + 1)
        : 10),
      source: 'Cache Explorer'
    }))

    monaco.editor.setModelMarkers(model, 'cache-explorer', markers)
  }, [error])

  // Apply decorations for cache analysis results
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !result) {
      if (editorRef.current && decorationsRef.current.length > 0) {
        decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, [])
      }
      return
    }

    const monaco = monacoRef.current
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    const decorations: editor.IModelDeltaDecoration[] = []

    for (const line of result.hotLines) {
      const fileName = line.file.split('/').pop() || line.file
      if (fileName.includes('cache-explorer') || fileName.startsWith('/tmp/')) {
        const lineNum = line.line
        if (lineNum > 0 && lineNum <= model.getLineCount()) {
          let className = 'line-good'
          let inlineClass = 'inline-good'
          if (line.missRate > 0.5) {
            className = 'line-bad'
            inlineClass = 'inline-bad'
          } else if (line.missRate > 0.2) {
            className = 'line-warn'
            inlineClass = 'inline-warn'
          }

          // Background highlight for the whole line
          decorations.push({
            range: new monaco.Range(lineNum, 1, lineNum, 1),
            options: {
              isWholeLine: true,
              className,
              glyphMarginClassName: className.replace('line-', 'glyph-'),
              glyphMarginHoverMessage: {
                value: `**${line.misses.toLocaleString()} misses** (${(line.missRate * 100).toFixed(1)}% miss rate)\n\n${line.hits.toLocaleString()} hits total`
              }
            }
          })

          // Inline annotation at end of line showing miss info
          const lineContent = model.getLineContent(lineNum)
          decorations.push({
            range: new monaco.Range(lineNum, lineContent.length + 1, lineNum, lineContent.length + 1),
            options: {
              after: {
                content: ` // ${line.misses} misses (${(line.missRate * 100).toFixed(0)}%)`,
                inlineClassName: inlineClass
              }
            }
          })
        }
      }
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations)
  }, [result])

  const runAnalysis = () => {
    // Input validation
    if (code.length > 100000) {
      setError({ type: 'validation_error', message: 'Code too long (max 100KB)', suggestion: 'Try a smaller program or use sampling' })
      return
    }
    if (code.trim().length === 0) {
      setError({ type: 'validation_error', message: 'No code to analyze', suggestion: 'Write or paste some code first' })
      return
    }

    setStage('connecting')
    setError(null)
    setResult(null)
    setTimeline([])
    setLongRunning(false)
    timelineRef.current = []

    // Set long-running warning after 10 seconds
    const longRunTimeout = setTimeout(() => setLongRunning(true), 10000)

    const ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      const payload: Record<string, unknown> = { code, config, optLevel, language }
      if (config === 'custom') payload.customConfig = customConfig
      if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())
      if (prefetchPolicy !== 'none') payload.prefetch = prefetchPolicy
      if (sampleRate > 1) payload.sample = sampleRate
      if (eventLimit > 0) payload.limit = eventLimit
      ws.send(JSON.stringify(payload))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'status') setStage(msg.stage as Stage)
      else if (msg.type === 'progress') {
        // Collect timeline events from streaming progress
        if (msg.timeline && Array.isArray(msg.timeline)) {
          timelineRef.current = [...timelineRef.current, ...msg.timeline]
          // Update timeline state periodically (every 200 events)
          if (timelineRef.current.length % 200 < msg.timeline.length) {
            setTimeline([...timelineRef.current])
          }
        }
      } else if (msg.type === 'result') {
        clearTimeout(longRunTimeout)
        setLongRunning(false)
        // Finalize timeline and set result
        setTimeline([...timelineRef.current])
        setResult({ ...(msg.data as CacheResult), timeline: timelineRef.current })
        setScrubberIndex(timelineRef.current.length)  // Start at end of timeline
        setStage('idle')
        ws.close()
      } else if (msg.type === 'error') {
        clearTimeout(longRunTimeout)
        setLongRunning(false)
        setError(msg as ErrorResult)
        setStage('idle')
        ws.close()
      }
    }

    ws.onerror = () => fallbackToHttp()
    ws.onclose = (e) => { if (!e.wasClean && stage !== 'idle') fallbackToHttp() }

    const fallbackToHttp = async () => {
      setStage('compiling')
      try {
        const payload: Record<string, unknown> = { code, config, optLevel, language }
        if (config === 'custom') payload.customConfig = customConfig
        if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())
        if (prefetchPolicy !== 'none') payload.prefetch = prefetchPolicy
        if (sampleRate > 1) payload.sample = sampleRate
        if (eventLimit > 0) payload.limit = eventLimit

        const response = await fetch(`${API_BASE}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await response.json()

        if (data.type || data.error) setError(data as ErrorResult)
        else if (data.levels) setResult(data as CacheResult)
        else setError({ type: 'unknown_error', message: 'Unexpected response' })
      } catch (err) {
        setError({ type: 'server_error', message: err instanceof Error ? err.message : 'Connection failed' })
      } finally {
        setStage('idle')
      }
    }
  }

  const isLoading = stage !== 'idle'
  const stageText = { idle: '', connecting: 'Connecting...', preparing: 'Preparing...', compiling: 'Compiling...', running: 'Running...', processing: 'Processing...', done: '' }

  return (
    <div className="app">
      <div className="toolbar">
        <div className="toolbar-left">
          <select
            className="select-example"
            onChange={(e) => {
              const ex = EXAMPLES[e.target.value]
              if (ex) {
                setCode(ex.code)
                setLanguage(ex.language)
                e.target.value = ''
              }
            }}
            defaultValue=""
          >
            <option value="" disabled>Examples</option>
            <optgroup label="C">
              {Object.entries(EXAMPLES).filter(([_, ex]) => ex.language === 'c').map(([key, ex]) => (
                <option key={key} value={key}>{ex.name}</option>
              ))}
            </optgroup>
            <optgroup label="C++">
              {Object.entries(EXAMPLES).filter(([_, ex]) => ex.language === 'cpp').map(([key, ex]) => (
                <option key={key} value={key}>{ex.name}</option>
              ))}
            </optgroup>
            <optgroup label="Rust">
              {Object.entries(EXAMPLES).filter(([_, ex]) => ex.language === 'rust').map(([key, ex]) => (
                <option key={key} value={key}>{ex.name}</option>
              ))}
            </optgroup>
          </select>

          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="select-lang" title="Programming language">
            <option value="c">C</option>
            <option value="cpp">C++</option>
            <option value="rust">Rust</option>
          </select>

          <select value={config} title="Simulated CPU cache configuration" onChange={(e) => {
            const newConfig = e.target.value
            setConfig(newConfig)
            // Auto-select default prefetch policy for this hardware
            const defaultPrefetch = PREFETCH_DEFAULTS[newConfig] || 'none'
            setPrefetchPolicy(defaultPrefetch)
          }} className="select-config">
            <optgroup label="Learning">
              <option value="educational">Educational (tiny)</option>
            </optgroup>
            <optgroup label="Intel">
              <option value="intel">Intel 12th Gen</option>
              <option value="intel14">Intel 14th Gen</option>
              <option value="xeon">Intel Xeon (Server)</option>
            </optgroup>
            <optgroup label="AMD">
              <option value="zen3">AMD Zen 3</option>
              <option value="amd">AMD Zen 4</option>
              <option value="epyc">AMD EPYC (Server)</option>
            </optgroup>
            <optgroup label="Apple">
              <option value="apple">Apple M1</option>
              <option value="m2">Apple M2</option>
              <option value="m3">Apple M3</option>
            </optgroup>
            <optgroup label="Cloud/ARM">
              <option value="graviton">AWS Graviton 3</option>
              <option value="rpi4">Raspberry Pi 4</option>
              <option value="embedded">Embedded (Cortex-A53)</option>
            </optgroup>
            <optgroup label="Custom">
              <option value="custom">Custom Config</option>
            </optgroup>
          </select>

          <select value={optLevel} onChange={(e) => setOptLevel(e.target.value)} className="select-opt" title="Compiler optimization level (-O0 shows more detail, -O2/-O3 show optimized behavior)">
            <option value="-O0">-O0</option>
            <option value="-O1">-O1</option>
            <option value="-O2">-O2</option>
            <option value="-O3">-O3</option>
          </select>

          <select value={prefetchPolicy} onChange={(e) => setPrefetchPolicy(e.target.value as PrefetchPolicy)} className="select-prefetch" title="Simulate hardware prefetching (auto-selected based on CPU)">
            <option value="none">No Prefetch</option>
            <option value="next">Next Line</option>
            <option value="stream">Stream</option>
            <option value="stride">Stride</option>
            <option value="adaptive">Adaptive</option>
          </select>
        </div>

        <div className="toolbar-center">
          <button onClick={runAnalysis} disabled={isLoading} className="btn-run">
            {isLoading ? stageText[stage] : 'Run'}
          </button>
          <span className="shortcut-hint">⌘↵</span>
        </div>

        <div className="toolbar-right">
          <button onClick={handleShare} className="btn-icon" title="Copy link">
            {copied ? 'Copied!' : 'Share'}
          </button>

          <div className="options-wrapper" ref={optionsRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowOptions(!showOptions) }}
              className={`btn-icon ${showOptions ? 'active' : ''}`}
            >
              Options
            </button>

            {showOptions && (
              <div className="options-dropdown">
                <div className="option-section">
                  <div className="option-label">Preprocessor Defines</div>
                  <div className="defines-list">
                    {defines.map((def, i) => (
                      <div key={i} className="define-row">
                        <span className="define-d">-D</span>
                        <input
                          type="text"
                          placeholder="NAME"
                          value={def.name}
                          onChange={(e) => {
                            const newDefs = [...defines]
                            newDefs[i].name = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')
                            setDefines(newDefs)
                          }}
                          className="define-name"
                        />
                        <span className="define-eq">=</span>
                        <input
                          type="text"
                          placeholder="value"
                          value={def.value}
                          onChange={(e) => {
                            const newDefs = [...defines]
                            newDefs[i].value = e.target.value
                            setDefines(newDefs)
                          }}
                          className="define-value"
                        />
                        <button className="btn-remove" onClick={() => setDefines(defines.filter((_, j) => j !== i))}>×</button>
                      </div>
                    ))}
                    <button className="btn-add" onClick={() => setDefines([...defines, { name: '', value: '' }])}>
                      + Add Define
                    </button>
                  </div>
                </div>

                <div className="option-divider" />

                <div className="option-section">
                  <div className="option-label">Performance</div>
                  <div className="perf-controls">
                    <div className="perf-row">
                      <label>Event Limit</label>
                      <select value={eventLimit} onChange={(e) => setEventLimit(Number(e.target.value))}>
                        <option value={100000}>100K</option>
                        <option value={500000}>500K</option>
                        <option value={1000000}>1M</option>
                        <option value={5000000}>5M (default)</option>
                        <option value={10000000}>10M</option>
                        <option value={0}>No limit</option>
                      </select>
                    </div>
                    <div className="perf-row">
                      <label>Sampling</label>
                      <select value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))}>
                        <option value={1}>All events</option>
                        <option value={10}>1:10 (10%)</option>
                        <option value={100}>1:100 (1%)</option>
                        <option value={1000}>1:1000 (0.1%)</option>
                      </select>
                    </div>
                  </div>
                  <div className="perf-hint">
                    Use sampling for large programs to prevent timeouts
                  </div>
                </div>

                <div className="option-divider" />

                <div className="option-section">
                  <div className="option-label">Diff Mode</div>
                  <button
                    className={`btn-option ${baselineCode ? '' : 'disabled'}`}
                    onClick={() => { if (baselineCode) setDiffMode(!diffMode) }}
                  >
                    {diffMode ? 'Exit Diff' : 'Show Diff'}
                  </button>
                  <button className="btn-option" onClick={() => setBaselineCode(code)}>
                    Set Current as Baseline
                  </button>
                </div>

                <div className="option-divider" />

                <div className="option-section">
                  <div className="option-label">Editor Mode</div>
                  <button
                    className={`btn-option ${vimMode ? 'active' : ''}`}
                    onClick={() => setVimMode(!vimMode)}
                  >
                    {vimMode ? 'Vim Mode ON' : 'Vim Mode OFF'}
                  </button>
                </div>

                {config === 'custom' && (
                  <>
                    <div className="option-divider" />
                    <div className="option-section">
                      <div className="option-label">Custom Cache Config</div>
                      <div className="config-grid">
                        <label>Line Size</label>
                        <input type="number" value={customConfig.lineSize} onChange={(e) => setCustomConfig({ ...customConfig, lineSize: parseInt(e.target.value) || 64 })} />
                        <label>L1 Size</label>
                        <input type="number" value={customConfig.l1Size} onChange={(e) => setCustomConfig({ ...customConfig, l1Size: parseInt(e.target.value) || 32768 })} />
                        <label>L1 Assoc</label>
                        <input type="number" value={customConfig.l1Assoc} onChange={(e) => setCustomConfig({ ...customConfig, l1Assoc: parseInt(e.target.value) || 8 })} />
                        <label>L2 Size</label>
                        <input type="number" value={customConfig.l2Size} onChange={(e) => setCustomConfig({ ...customConfig, l2Size: parseInt(e.target.value) || 262144 })} />
                        <label>L2 Assoc</label>
                        <input type="number" value={customConfig.l2Assoc} onChange={(e) => setCustomConfig({ ...customConfig, l2Assoc: parseInt(e.target.value) || 8 })} />
                        <label>L3 Size</label>
                        <input type="number" value={customConfig.l3Size} onChange={(e) => setCustomConfig({ ...customConfig, l3Size: parseInt(e.target.value) || 8388608 })} />
                        <label>L3 Assoc</label>
                        <input type="number" value={customConfig.l3Assoc} onChange={(e) => setCustomConfig({ ...customConfig, l3Assoc: parseInt(e.target.value) || 16 })} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="main">
        <div className="editor-pane">
          {diffMode && baselineCode ? (
            <DiffEditor
              height="100%"
              language={monacoLanguage}
              theme="vs-dark"
              original={baselineCode}
              modified={code}
              onMount={(editor) => {
                const modifiedEditor = editor.getModifiedEditor()
                modifiedEditor.onDidChangeModelContent(() => setCode(modifiedEditor.getValue()))
              }}
              options={{ minimap: { enabled: false }, fontSize: 13, renderSideBySide: true }}
            />
          ) : (
            <Editor
              height={vimMode ? "calc(100% - 24px)" : "100%"}
              language={monacoLanguage}
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value || '')}
              onMount={handleEditorMount}
              options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', scrollBeyondLastLine: false, glyphMargin: true }}
            />
          )}
          {vimMode && <div ref={vimStatusRef} className="vim-status-bar" />}
        </div>

        <div className="results-pane">
          {error && <ErrorDisplay error={error} />}

          {result && (
            <>
              <CacheBar result={result} sampled={sampleRate > 1} />

              {result.prefetch && (
                <div className="prefetch-stats">
                  <div className="prefetch-header">
                    <span className="prefetch-icon">⚡</span>
                    <span className="prefetch-title">Prefetching: {result.prefetch.policy}</span>
                  </div>
                  <div className="prefetch-details">
                    <span className="prefetch-stat">
                      <span className="stat-label">Issued</span>
                      <span className="stat-value">{result.prefetch.issued.toLocaleString()}</span>
                    </span>
                    <span className="prefetch-stat">
                      <span className="stat-label">Useful</span>
                      <span className="stat-value">{result.prefetch.useful.toLocaleString()}</span>
                    </span>
                    <span className="prefetch-stat">
                      <span className="stat-label">Accuracy</span>
                      <span className={`stat-value ${result.prefetch.accuracy > 0.5 ? 'good' : result.prefetch.accuracy > 0.2 ? 'ok' : ''}`}>
                        {(result.prefetch.accuracy * 100).toFixed(1)}%
                      </span>
                    </span>
                  </div>
                </div>
              )}

              <div className="btn-row">
                <button className="btn-toggle" onClick={() => setShowDetails(!showDetails)}>
                  {showDetails ? 'Hide Details' : 'Details'}
                </button>
                <button className="btn-toggle" onClick={() => setShowTimeline(!showTimeline)}>
                  {showTimeline ? 'Hide Timeline' : 'Timeline'}
                </button>
              </div>

              {showTimeline && timeline.length > 0 && (
                <AccessTimeline
                  events={timeline}
                  onEventClick={(line) => {
                    if (editorRef.current) {
                      editorRef.current.revealLineInCenter(line)
                      editorRef.current.setPosition({ lineNumber: line, column: 1 })
                      editorRef.current.focus()
                    }
                  }}
                />
              )}

              {showDetails && (
                <>
                  <div className="details-grid">
                    <LevelDetail name="L1 Data" stats={result.levels.l1d || result.levels.l1!} />
                    {result.levels.l1i && <LevelDetail name="L1 Instruction" stats={result.levels.l1i} />}
                    <LevelDetail name="L2" stats={result.levels.l2} />
                    <LevelDetail name="L3" stats={result.levels.l3} />
                  </div>
                  <CacheHierarchyViz
                    result={result}
                    timeline={timeline}
                    scrubberIndex={scrubberIndex}
                    onScrubberChange={setScrubberIndex}
                  />
                </>
              )}

              {result.coherence && result.coherence.falseSharingEvents > 0 && (
                <div className="warning-box">
                  <div className="warning-title">False Sharing Detected</div>
                  <div className="warning-count">{result.coherence.falseSharingEvents} event(s)</div>
                </div>
              )}

              {result.falseSharing && result.falseSharing.length > 0 && (
                <FalseSharingViz
                  falseSharing={result.falseSharing}
                  lineSize={result.cacheConfig?.l1d?.lineSize || 64}
                />
              )}

              {result.hotLines.length > 0 && (
                <div className="hotlines">
                  <div className="section-title">Hot Lines</div>
                  <table>
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>Misses</th>
                        <th>Miss Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.hotLines.slice(0, 10).map((hotLine, i) => (
                        <tr
                          key={i}
                          className="clickable-row"
                          onClick={() => {
                            if (editorRef.current && hotLine.line > 0) {
                              editorRef.current.revealLineInCenter(hotLine.line)
                              editorRef.current.setPosition({ lineNumber: hotLine.line, column: 1 })
                              editorRef.current.focus()
                            }
                          }}
                        >
                          <td className="mono">{hotLine.line}</td>
                          <td className="mono">{hotLine.misses.toLocaleString()}</td>
                          <td className={`mono ${hotLine.missRate > 0.5 ? 'bad' : hotLine.missRate > 0.2 ? 'ok' : 'good'}`}>
                            {formatPercent(hotLine.missRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.suggestions && result.suggestions.length > 0 && (
                <div className="suggestions">
                  <div className="section-title">Suggestions</div>
                  {result.suggestions.map((s, i) => (
                    <div key={i} className={`suggestion ${s.severity}`}>
                      <span className={`badge ${s.severity}`}>{s.severity}</span>
                      <span className="suggestion-msg">{s.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {isLoading && (
            <div className="loading">
              <div className="spinner" />
              <span>{stageText[stage]}</span>
              {longRunning && (
                <div className="long-running-warning">
                  Taking longer than expected. Try enabling sampling in Options.
                </div>
              )}
            </div>
          )}

          {!result && !error && !isLoading && (
            <div className="placeholder">
              <div className="placeholder-icon">📊</div>
              <div className="placeholder-title">Cache Explorer</div>
              <div className="placeholder-text">
                Write or paste code, then press <kbd>⌘</kbd>+<kbd>↵</kbd> to analyze cache behavior
              </div>
              <div className="placeholder-tips">
                <div className="tip">💡 Try the Examples dropdown for common patterns</div>
                <div className="tip">⚙️ Change hardware preset to simulate different CPUs</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
