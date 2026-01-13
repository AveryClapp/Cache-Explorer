export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state-logo">
        <div className="logo-layer l3"></div>
        <div className="logo-layer l2"></div>
        <div className="logo-layer l1"></div>
      </div>
      <div className="empty-state-title">Ready to Analyze</div>
      <div className="empty-state-desc">
        Write or paste C/C++ code in the editor, then execute to visualize cache behavior.
      </div>
      <div className="empty-state-shortcut">
        Press <kbd>⌘</kbd>+<kbd>Enter</kbd> to run
      </div>
    </div>
  )
}
