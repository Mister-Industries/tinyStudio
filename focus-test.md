# FileTreeItem Focus Behavior Test

The FileTreeItem component now supports keyboard navigation and focus management:

## Features Implemented

1. **Focus Management**: Each FileTreeItem is now focusable with `tabIndex={0}`
2. **Keyboard Navigation**:
   - Up/Down arrow keys move focus between tree items
   - Focus follows the visual order of items on screen
3. **Actions**:
   - `Enter` key starts rename process
   - `Ctrl/Cmd + Enter` opens the file in editor
   - `Space` key opens the context menu
4. **Visual Focus**: Added focus ring styling for accessibility

## Technical Details

- Added `itemRef` for DOM reference
- Added `handleKeyDown` function for keyboard event handling
- Added `findNextFocusableItem` helper for navigation
- Used `data-tree-item="true"` attribute to identify focusable items
- Prevented keyboard handling during rename mode

## Usage

1. Click on a file/folder to focus it
2. Use arrow keys to navigate up/down
3. Press Enter to rename
4. Press Ctrl+Enter to open file
5. Press Space to open context menu
