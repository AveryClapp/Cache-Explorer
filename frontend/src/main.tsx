import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js'
import './index.css'
import App from './App.tsx'

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}
loader.config({ monaco })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
