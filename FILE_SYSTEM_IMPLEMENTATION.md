# Cross-Platform File System Implementation for React Electron IDE

This document outlines the comprehensive file system implementation that works both in Electron and web browsers for the TinyStudio IDE.

## Architecture Overview

The file system implementation consists of several layers:

1. **Electron Main Process Handlers** - IPC handlers for native file operations
2. **Electron Preload Script** - Secure bridge exposing file system APIs
3. **Web File System Service** - File System Access API implementation for browsers
4. **Unified File System Service** - Cross-platform abstraction layer
5. **React Hooks** - State management and React integration
6. **UI Components** - File explorer and editor integration

## Components Implemented

### 1. Electron Main Process Handlers (`src/main/index.ts`)

Added IPC handlers for:

- `select-folder` - Opens native folder picker dialog
- `read-directory` - Reads directory contents recursively
- `read-file` - Reads file content as UTF-8 text
- `write-file` - Writes content to file
- `create-file` - Creates new file
- `create-folder` - Creates new directory
- `delete-file` - Deletes file or directory
- `path-exists` - Checks if path exists
- `get-file-stats` - Gets file metadata

Features:

- Error handling with detailed logging
- Path validation and security
- Recursive directory operations
- Duplicate handler prevention

### 2. Electron Preload Script (`src/preload/index.ts`)

Secure bridge using `contextBridge.exposeInMainWorld` that exposes:

- All file system operations as methods under `window.api.fs`
- TypeScript interfaces for type safety
- Proper error propagation

### 3. Web File System Service (`src/renderer/src/lib/webFileSystem.ts`)

Browser-compatible implementation using File System Access API:

- `selectFolder()` - Directory picker with fallback
- `readDirectory()` - Directory enumeration
- `readFile()`, `writeFile()` - File I/O operations
- `createFile()`, `createFolder()` - Creation operations
- `deleteFile()` - Deletion with recursive support
- Handle caching for performance
- Feature detection for API support

### 4. Unified File System Service (`src/renderer/src/lib/fileSystem.ts`)

Cross-platform abstraction providing:

- Environment detection (Electron vs Web)
- Consistent API for both platforms
- Error handling and user feedback
- Utility methods for path manipulation
- File type detection (text, image, code)
- Path normalization and joining

### 5. React Hooks (`src/renderer/src/lib/useFileSystem.ts`)

Custom hooks for state management:

#### `useFileSystem(options)`

- Workspace management
- File operations with loading states
- Error handling and recovery
- Unsaved changes tracking
- Keyboard shortcuts (Ctrl+O, Ctrl+S)

#### `useFileContent(filePath)`

- File content loading
- Automatic reloading on path change
- Loading and error states

#### `useFileTree(files)`

- Tree state management (expanded/collapsed)
- File selection tracking
- Bulk operations (expand/collapse all)

### 6. File Explorer Component (`src/renderer/src/components/FileExplorer.tsx`)

Modern file explorer with:

- Tree view with expand/collapse
- File type icons (folder, code, image, generic)
- Context menus for file operations
- Drag and drop support (structure ready)
- Integration with Redux store
- Real-time file creation
- Error notifications with dismiss

### 7. Editor Integration

Updated components for seamless integration:

#### MonacoEditor (`src/renderer/src/components/MonacoEditor.tsx`)

- Ctrl+S save functionality
- Auto-save integration with file system
- File path tracking in Redux

#### EditorPanel (`src/renderer/src/components/EditorPanel.tsx`)

- Visual indicators for unsaved files
- Tab management for multiple files
- Automatic file opening from explorer

#### Redux Store Updates (`src/renderer/src/redux/fileSlice.ts`)

- Extended `EditorFile` interface with `path` property
- Added `saveFile` action for save state management
- Integration with file system operations

## Key Features

### Cross-Platform Compatibility

- **Electron**: Native file system access with full permissions
- **Web**: File System Access API with graceful fallback
- **Consistent API**: Same interface regardless of platform

### Error Handling

- Comprehensive error catching and logging
- User-friendly error messages
- Graceful degradation for unsupported features

### Performance Optimizations

- File handle caching in web mode
- Efficient tree rendering with virtualization support
- Debounced file operations
- Lazy loading of directory contents

### User Experience

- Visual feedback for all operations
- Loading states and progress indicators
- Keyboard shortcuts for common operations
- Unsaved changes indicators
- Context menus for quick actions

### Security

- Sandboxed preload script with minimal API exposure
- Path validation and sanitization
- Permission-based access in web mode

## Usage Examples

### Opening a Workspace

```typescript
const { selectWorkspace, files, isLoading, error } = useFileSystem()

// Open folder picker
await selectWorkspace()

// Files are automatically loaded and available in `files` array
```

### Creating and Editing Files

```typescript
const { createFile, openFile } = useFileSystem()

// Create new file
await createFile('/path/to/new-file.txt', 'Initial content')

// Open file in editor
const content = await openFile('/path/to/file.txt')
```

### File System Detection

```typescript
import { fileSystem } from '../lib/fileSystem'

if (fileSystem.isElectron()) {
  // Electron-specific features
} else if (fileSystem.supportsFileSystemAccess()) {
  // Web File System Access API
} else {
  // Fallback mode
}
```

## Browser Compatibility

### File System Access API Support

- Chrome 86+
- Edge 86+
- Safari: Partial support (read-only)
- Firefox: Not supported (fallback required)

### Fallback Strategy

- Input element with `webkitdirectory` for folder selection
- File drag-and-drop for individual files
- Limited write capabilities (download-based saves)

## Development Notes

### Running the Application

```bash
# Development mode (Electron)
npm run dev

# Web development mode
npm run dev:web

# Production build
npm run build
```

### Testing File Operations

1. Start the development server
2. Click "Open Folder" in the File Explorer
3. Select a directory with various file types
4. Test file operations:
   - Click files to open in editor
   - Use Ctrl+S to save changes
   - Create new files with the "+" button
   - Observe unsaved change indicators

### Extending the Implementation

#### Adding New File Operations

1. Add IPC handler in `src/main/index.ts`
2. Expose via preload script in `src/preload/index.ts`
3. Implement web equivalent in `src/renderer/src/lib/webFileSystem.ts`
4. Add unified method in `src/renderer/src/lib/fileSystem.ts`
5. Integrate with React hooks as needed

#### Custom File Types

Add detection logic in `fileSystem.ts`:

```typescript
isCustomFile(fileName: string): boolean {
  const customExtensions = ['custom', 'special']
  return customExtensions.includes(this.getFileExtension(fileName))
}
```

## Future Enhancements

### Planned Features

- [ ] File watching for external changes (Electron)
- [ ] Advanced search and filtering
- [ ] Bulk file operations
- [ ] File comparison and diff view
- [ ] Integration with version control systems
- [ ] Cloud storage adapters
- [ ] Collaborative editing support
- [ ] Plugin system for custom file handlers

### Performance Improvements

- [ ] Virtual scrolling for large directories
- [ ] Background file indexing
- [ ] Thumbnail generation for images
- [ ] Smart caching strategies
- [ ] Progressive loading for deep directory trees

## Troubleshooting

### Common Issues

#### "Permission denied" errors

- Ensure proper file permissions
- Check if files are locked by other applications
- Verify directory write access

#### File System Access API not working

- Check browser compatibility
- Ensure HTTPS context (required for API)
- Verify user gesture requirement for API calls

#### IPC handler errors

- Check for duplicate handler registration
- Verify preload script loading
- Ensure context isolation settings

### Debug Tips

- Enable verbose logging in development
- Use browser dev tools for web debugging
- Check Electron main process console for IPC issues
- Monitor Redux dev tools for state changes

## Security Considerations

### Electron Security

- Preload script runs in isolated context
- Limited API surface exposed to renderer
- No direct Node.js access from renderer

### Web Security

- File System Access API requires user permission
- Limited to user-selected directories
- No arbitrary file system access

### Best Practices

- Validate all file paths server-side
- Sanitize file names and content
- Implement proper error boundaries
- Use secure file handling practices

## Contributing

When contributing to the file system implementation:

1. Maintain cross-platform compatibility
2. Add comprehensive error handling
3. Include TypeScript types for all APIs
4. Write tests for new functionality
5. Update documentation for API changes
6. Follow the established patterns for state management
