# Multi-File Projects & Compiler Explorer Assembly View

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Enable multi-file project analysis and provide assembly view integration via Compiler Explorer button positioned as primary assembly viewer.

**Architecture:**
- **Backend:** Accept multiple files in API, compile them together, track file attribution in trace events
- **Frontend:** Send all files to backend, organize results by file, position Compiler Explorer button as "View Assembly"
- **Simulator:** No changes needed (already supports file attribution via source lines)

**Tech Stack:** Node.js/Express backend, React frontend, LLVM/Clang compilation, Compiler Explorer API

---

## Implementation Tasks

### Task 1: Backend API - Accept multiple files

**Files:**
- Modify: `backend/server/server.js` - Add multi-file support to /api/analyze endpoint
- Modify: `backend/cache-simulator/src/main.cpp` - Accept multiple input files

**Step 1: Update API to accept file array**

Modify `/backend/server/server.js` POST /api/analyze endpoint:

Current (single file):
```javascript
const { code, config, optLevel, ... } = req.body
```

New (multiple files):
```javascript
const { files, config, optLevel, ... } = req.body
// files: [{ name: "main.c", code: "...", language: "c" }, ...]
```

**Step 2: Write files to temp directory**

```javascript
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-explore-'))
const fileMap = {}
files.forEach(f => {
  const filePath = path.join(tempDir, f.name)
  fs.writeFileSync(filePath, f.code)
  fileMap[f.name] = filePath
})
```

**Step 3: Update compilation command**

Pass all files to compiler:
```javascript
// Old: clang++ -o binary input.c
// New: clang++ -o binary main.c helper.c util.c
const allFiles = files.map(f => f.name).join(' ')
const command = `clang++ ${optLevel} ... ${allFiles} -o ${binaryPath}`
```

**Step 4: Verify build succeeds**

Run: `cd backend && npm test 2>&1 | grep -i "multi\|file"`
Expected: No errors with multiple file input

**Step 5: Commit**

```bash
git add backend/server/server.js
git commit -m "feat: backend support for multiple files in analysis"
```

---

### Task 2: Frontend - Send multiple files to backend

**Files:**
- Modify: `frontend/src/hooks/useAnalysisExecution.ts` - Update to send all files
- Modify: `frontend/src/App.tsx` - No changes needed (already has files array)

**Step 1: Update useAnalysisExecution to send all files**

In `useAnalysisExecution.ts`, modify the fetch to `/api/analyze`:

```typescript
// Old (single file)
body: JSON.stringify({
  code: params.mainFile.code,
  config: params.config,
  ...
})

// New (multiple files)
body: JSON.stringify({
  files: params.files.map(f => ({
    name: f.name,
    code: f.code,
    language: f.language
  })),
  config: params.config,
  mainFile: params.mainFileId,
  ...
})
```

**Step 2: Update hook parameters**

Hook signature stays same (takes files array), just sends it differently.

**Step 3: Verify TypeScript builds**

Run: `cd frontend && npm run build 2>&1 | head -20`
Expected: 0 errors

**Step 4: Test with multi-file example**

Manually test by creating:
- File 1: `main.c` with main function
- File 2: `helper.c` with utility function
- File 3: `util.c` with more utilities

Verify analysis runs without errors.

**Step 5: Commit**

```bash
git add frontend/src/hooks/useAnalysisExecution.ts
git commit -m "feat: frontend sends multiple files to backend for analysis"
```

---

### Task 3: Results display - Show file attribution

**Files:**
- Modify: `frontend/src/components/HotLinesTable.tsx` - Group by file
- Modify: `frontend/src/App.tsx` - Add file filter UI

**Step 1: Update HotLinesTable to group by file**

Current output shows hot lines but doesn't distinguish files clearly.

Add file grouping:

```typescript
// Group hot lines by file
const hotLinesByFile = useMemo(() => {
  const groups: Record<string, HotLine[]> = {}
  result.hotLines.forEach(line => {
    if (!groups[line.file]) groups[line.file] = []
    groups[line.file].push(line)
  })
  return groups
}, [result.hotLines])

// Render with file headers
return (
  <>
    {Object.entries(hotLinesByFile).map(([file, lines]) => (
      <div key={file} className="hot-lines-file-group">
        <h4 className="file-header">{file}</h4>
        <table>
          {lines.map(line => (...))}
        </table>
      </div>
    ))}
  </>
)
```

**Step 2: Add file filter to results**

In App.tsx render, add file selector if multiple files:

```typescript
{analysisState.files.length > 1 && (
  <div className="file-filter">
    <label>Filter by file:</label>
    <select onChange={(e) => setSelectedFile(e.target.value)}>
      <option value="">All files</option>
      {analysisState.files.map(f => (
        <option key={f.id} value={f.name}>{f.name}</option>
      ))}
    </select>
  </div>
)}
```

**Step 3: Add CSS for file grouping**

In `App.css`, add:
```css
.hot-lines-file-group {
  margin-bottom: 2rem;
  border-left: 3px solid var(--accent-color);
  padding-left: 1rem;
}

.file-header {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0.5rem 0 1rem 0;
  font-weight: 600;
}
```

**Step 4: Verify build and test**

Run: `cd frontend && npm run build`
Expected: 0 errors, layout looks correct

**Step 5: Commit**

```bash
git add frontend/src/components/HotLinesTable.tsx frontend/src/App.tsx frontend/src/App.css
git commit -m "feat: show file attribution in results with grouping and filtering"
```

---

### Task 4: Compiler Explorer - Position as assembly view

**Files:**
- Modify: `frontend/src/App.tsx` - Rename button and reposition
- Modify: `frontend/src/App.css` - Style as primary action

**Step 1: Update button text and icon**

In App.tsx, find the Compiler Explorer button (in results section):

```typescript
// Old
<button onClick={openInCompilerExplorer}>
  View in Compiler Explorer
</button>

// New
<button className="btn-assembly-view" onClick={openInCompilerExplorer}>
  📦 View Generated Assembly
</button>
```

**Step 2: Move button to prominent location**

Position in results header (next to download, share buttons):

```typescript
<div className="results-header">
  <div className="results-title">Cache Analysis Results</div>
  <div className="results-actions">
    <button className="btn-assembly-view" onClick={openInCompilerExplorer}>
      📦 View Generated Assembly
    </button>
    <button onClick={handleShare}>Share</button>
    <button onClick={downloadResults}>Download Report</button>
  </div>
</div>
```

**Step 3: Add CSS styling**

In `App.css`:
```css
.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.results-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-assembly-view {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 0.6rem 1.2rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: transform 0.2s;
}

.btn-assembly-view:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}
```

**Step 4: Add tooltip explaining assembly view**

```typescript
<button
  className="btn-assembly-view"
  onClick={openInCompilerExplorer}
  title="View the generated assembly code with your selected compiler and optimization level"
>
  📦 View Generated Assembly
</button>
```

**Step 5: Verify build**

Run: `cd frontend && npm run build`
Expected: 0 errors, button appears correctly styled

**Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.css
git commit -m "feat: position Compiler Explorer as assembly view with prominent button"
```

---

### Task 5: Enhance Compiler Explorer integration

**Files:**
- Modify: `frontend/src/App.tsx` - openInCompilerExplorer function
- Modify: `frontend/src/hooks/useAnalysisExecution.ts` - Pass compiler info

**Step 1: Include selected compiler in link**

Update `openInCompilerExplorer` to use selected compiler:

```typescript
const openInCompilerExplorer = useCallback(() => {
  const sourceCode = analysisState.code
  const lang = analysisState.language

  // Map Cache Explorer compilers to Compiler Explorer IDs
  const ceCompilerMap: Record<string, string> = {
    'clang-18': 'clang1800',
    'clang-17': 'clang1700',
    'gcc-13': 'g1330',
    'gcc-14': 'g1400',
    // ... add all available compilers
  }

  // Get selected compiler from configState
  const selectedCECompiler = ceCompilerMap[configState.selectedCompiler] || 'clang1800'

  // Build CE link with selected compiler
  const ceState = {
    sessions: [{
      id: 1,
      language: lang === 'cpp' ? 'c++' : lang,
      source: sourceCode,
      compilers: [{
        id: selectedCECompiler,
        options: optMap[configState.optLevel] || '-O2'
      }]
    }]
  }

  // ... rest of function
}, [analysisState.code, analysisState.language, configState.selectedCompiler, configState.optLevel])
```

**Step 2: Add SIMD and optimization flags**

```typescript
// Include flags that affect assembly output
const ceFlags = []
if (configState.optLevel !== '-O0') {
  ceFlags.push('-march=native')  // Show CPU-specific optimizations
}

const ceState = {
  sessions: [{
    id: 1,
    language: lang === 'cpp' ? 'c++' : lang,
    source: sourceCode,
    compilers: [{
      id: selectedCECompiler,
      options: `${optMap[configState.optLevel]} ${ceFlags.join(' ')}`
    }]
  }]
}
```

**Step 3: Test with different compilers**

Manually verify that:
- Selecting clang-18 shows clang assembly
- Selecting gcc-14 shows gcc assembly
- Different optimization levels show different assembly

**Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/hooks/useAnalysisExecution.ts
git commit -m "feat: enhance Compiler Explorer link with compiler and optimization selection"
```

---

### Task 6: Integration testing

**Files:**
- Create: `frontend/tests/multifile.test.ts` (optional but recommended)

**Step 1: Create multi-file test project**

Create a test case:
- main.c: Calls function from helper.c
- helper.c: Implements function with loop
- util.c: Utility functions

**Step 2: Run analysis on multi-file project**

Verify:
- All files compile correctly
- Results show cache behavior
- Hot lines are attributed to correct files
- Files can be filtered

**Step 3: Test assembly view**

- Click "View Generated Assembly"
- Verify Compiler Explorer opens with correct code
- Verify compiler selection matches
- Verify optimization level matches

**Step 4: Verify both features work together**

- Create multi-file project
- Run analysis
- Filter by file
- View assembly for that file
- Verify assembly matches the filtered code

**Step 5: Commit (no code changes, just verification)**

```bash
git add tests/  # if any test files created
git commit -m "test: verify multi-file and assembly view integration"
```

---

## Success Criteria

✓ Backend accepts multiple files via API
✓ Frontend sends all files in analysis request
✓ Results show file attribution with grouping
✓ File filter allows viewing results per-file
✓ Compiler Explorer button positioned as "View Assembly"
✓ Button styled prominently in results header
✓ Assembly view respects compiler and optimization selection
✓ Multi-file and assembly features work together
✓ All functionality tested manually
✓ TypeScript: 0 errors
✓ Build: successful
✓ 6 clean commits

---

## Notes

- Multi-file support requires no simulator changes (already tracks file attribution)
- Compiler Explorer button already exists, just needs repositioning and styling
- File grouping in results is purely UI (no backend changes needed)
- Both features can be implemented in parallel or sequentially
