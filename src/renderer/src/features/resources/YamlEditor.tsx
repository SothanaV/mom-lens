import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'

export interface YamlEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string
  editable?: boolean
}

export default function YamlEditor({
  value,
  onChange,
  height = '400px',
  editable = true
}: YamlEditorProps) {
  return (
    <CodeMirror
      value={value}
      height={height}
      theme={oneDark}
      editable={editable}
      readOnly={!editable}
      extensions={[yaml(), EditorView.lineWrapping]}
      onChange={onChange}
      basicSetup={{ foldGutter: true, autocompletion: false }}
      style={{
        fontSize: 12,
        border: '1px solid rgba(128, 128, 128, 0.35)',
        borderRadius: 4,
        overflow: 'hidden'
      }}
    />
  )
}
