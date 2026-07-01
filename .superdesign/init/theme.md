# Theme

## CSS Entry

`frontend/src/App.tsx` imports `frontend/src/styles/index.css`, which composes the app CSS bundle.

```css
/* Cache Explorer Styles - Entry Point */

/* Base */
@import './base.css';
@import './layout.css';

/* Workspace */
@import './workspace.css';
@import './editor.css';

/* Results */
@import './results-base.css';
@import './metrics.css';
@import './cache-viz.css';
@import './results-panels.css';
@import './stats.css';
@import './details.css';
@import './hotspots.css';

/* UI */
@import './states.css';
@import './panels.css';
@import './modals.css';

/* Overrides */
@import './mobile.css';
@import './themes.css';
@import './animations.css';
```

## Core Tokens

Source: `frontend/src/styles/base.css`

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@300;400;500;600&display=swap');

:root {
  --void: #1e1e1e;
  --panel: #252526;
  --surface: #2d2d2d;
  --elevated: #3c3c3c;
  --border: #404040;
  --border-glow: #505050;

  --phosphor: #4ec9b0;
  --phosphor-dim: #3ba992;
  --phosphor-glow: transparent;
  --phosphor-subtle: rgba(78, 201, 176, 0.1);

  --text-bright: #e8eaed;
  --text-primary: #b8bcc4;
  --text-secondary: #6b7280;
  --text-muted: #404550;

  --signal-excellent: #4ec9b0;
  --signal-good: #b5cea8;
  --signal-success: #b5cea8;
  --signal-warning: #dcdcaa;
  --signal-critical: #f14c4c;
  --signal-info: #4ec9b0;

  --heat-cold: #1a2a4a;
  --heat-cool: #2a4a6a;
  --heat-warm: #6a4a2a;
  --heat-hot: #8a2a2a;
  --heat-critical: #cc2222;

  --font-display: 'JetBrains Mono', monospace;
  --font-body: 'IBM Plex Mono', monospace;
  --font-code: 'JetBrains Mono', monospace;

  --text-2xs: 0.625rem;
  --text-xs: 0.6875rem;
  --text-sm: 0.75rem;
  --text-base: 0.8125rem;
  --text-md: 0.875rem;
  --text-lg: 1rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 2rem;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;

  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 6px;

  --shadow-glow: none;
  --shadow-panel: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-inset: none;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;

  --header-height: 52px;
  --toolbar-height: 40px;
  --sidebar-width: 280px;
  --results-width: 420px;
}
```

## Layout Character

- Dense engineering workspace, not a landing page.
- Dark instrument-console palette with restrained teal, green, yellow, and red signal colors.
- Small monospace typography.
- Panels, tables, controls, and modals use 2-6px radii.
- Product screens should prioritize scanability, provenance, reproducibility, and fast repeated use.
