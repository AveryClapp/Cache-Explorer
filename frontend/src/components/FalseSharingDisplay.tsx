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

interface FalseSharingDisplayProps {
  falseSharing: FalseSharingEvent[]
  lineSize?: number
}

export function FalseSharingDisplay({ falseSharing, lineSize = 64 }: FalseSharingDisplayProps) {
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
