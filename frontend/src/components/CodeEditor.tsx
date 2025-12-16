import Editor from '@monaco-editor/react'

interface CodeEditorProps {
  code: string
  onChange: (value: string) => void
}

export default function CodeEditor({ code, onChange }: CodeEditorProps) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Editor
        height="100%"
        defaultLanguage="cpp"
        value={code}
        onChange={(value) => onChange(value || '')}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
      />
    </div>
  )
}
