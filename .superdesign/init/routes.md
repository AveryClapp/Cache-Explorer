# Routes

## Routing Model

Cache Explorer is a Vite single-page React app with no router package. `frontend/src/main.tsx` mounts `frontend/src/App.tsx` at `#root`.

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

## Route Map

| URL | Entry | Layout |
| --- | --- | --- |
| `/` | `frontend/src/App.tsx` | Header + settings toolbar + sidebar + editor + results panel |

## URL State

The app uses URL parameters and hash/share state rather than route files:

- `?embed=true` enables embedded presentation mode.
- `?readonly=true` prevents editor writes.
- Share URLs restore files, active/main file, hardware settings, compiler, fidelity settings, and experiment setup.

## Key UI States

- Empty/default state: `ResultsPanel` renders `EmptyState`.
- Loading state: `EditorPanel` status bar and `LoadingState` render progress.
- Result state: `ResultsPanel` renders metrics, provenance, hardware profile, cache hierarchy, hot lines, suggestions, and exports.
- Workload browser: `WorkloadCatalogModal`.
- Hardware explorer: `HardwareExplorerModal`.
- Experiment results: `ExperimentResultsModal`.
