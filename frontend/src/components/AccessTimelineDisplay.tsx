interface TimelineEvent {
  i: number
  t: 'R' | 'W' | 'I'
  l: 1 | 2 | 3 | 4
  a?: number
  f?: string
  n?: number
}

interface AccessTimelineDisplayProps {
  events: TimelineEvent[]
  onEventClick?: (line: number) => void
}

export function AccessTimelineDisplay({ events, onEventClick }: AccessTimelineDisplayProps) {
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
