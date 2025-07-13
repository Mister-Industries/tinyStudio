# Editor State Management

This document explains how the state management works between the Blockly and Monaco editors in the TinyStudio application.

## Overview

The application now supports seamless switching between Blockly (visual blocks) and Monaco (text code) editors while maintaining the same code state. When you switch between editors, your changes are preserved.

## Architecture

### 1. Parent Component (EditorPanel.tsx)
- **State Management**: The `EditorPanel` component manages the file content state
- **Content Storage**: Uses `useState` to store the current Arduino code as a string
- **Callback Function**: Provides `handleContentChange` callback to both editors

### 2. Child Components
- **BlocklyEditor**: Accepts `content` and `onContentChange` props
- **MonacoEditor**: Accepts `content` and `onContentChange` props

## Data Flow

```
EditorPanel (Parent)
├── fileContent (state)
├── handleContentChange (callback)
├── BlocklyEditor (Child)
│   ├── content={fileContent}
│   └── onContentChange={handleContentChange}
└── MonacoEditor (Child)
    ├── content={fileContent}
    └── onContentChange={handleContentChange}
```

## Conversion Process

### Arduino Code → Blockly XML
- **Function**: `arduinoCodeToXml()` in `arduinoConverter.ts`
- **Process**: Parses Arduino code line by line and converts to Blockly XML format
- **Supported Commands**:
  - `pinMode()`
  - `digitalWrite()`
  - `Serial.begin()`
  - `Serial.print()` / `Serial.println()`
  - `delay()`

### Blockly XML → Arduino Code
- **Function**: `xmlToArduinoCode()` in `arduinoConverter.ts`
- **Process**: Uses existing `ArduinoGenerator` to convert blocks to code
- **Method**: `ArduinoGenerator.workspaceToCode(workspace)`

## Usage

1. **Start in Code View**: Edit Arduino code in the Monaco editor
2. **Switch to Blocks**: Click the "Blocks" button to see visual representation
3. **Edit Blocks**: Modify the visual blocks
4. **Switch Back**: Click "Code" to see the updated Arduino code
5. **Changes Preserved**: All modifications are maintained across switches

## Implementation Details

### BlocklyEditor
- Listens for workspace changes via `workspace.addChangeListener()`
- Converts workspace to Arduino code using `ArduinoGenerator.workspaceToCode()`
- Calls `onContentChange()` to update parent state
- Loads content from parent via `loadContentIntoWorkspace()`

### MonacoEditor
- Listens for content changes via `editor.onDidChangeModelContent()`
- Calls `onContentChange()` to update parent state
- Updates editor content when prop changes via `useEffect()`

## Future Improvements

1. **Better Parsing**: More sophisticated Arduino code parsing
2. **Variable Support**: Handle variable declarations and assignments
3. **Function Support**: Convert custom functions to blocks
4. **Error Handling**: Better error recovery for malformed code
5. **Performance**: Optimize conversion for large code files

## Files Modified

- `src/renderer/src/components/EditorPanel.tsx` - Added state management
- `src/renderer/src/components/BlocklyEditor.tsx` - Added props and conversion
- `src/renderer/src/components/MonacoEditor.tsx` - Added props and change handling
- `src/renderer/src/lib/arduinoConverter.ts` - New conversion utilities 