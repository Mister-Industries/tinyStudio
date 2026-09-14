# Where state lives

tinyStudio keeps state in four places. Each has one job; pick by who reads the
state and how long it lives, not by what's closest to hand.

| Kind of state                                                          | Where                                                                                                                  | Examples                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The open project and the app's layout, read across many components     | **Redux** (`src/renderer/src/redux/`)                                                                                  | the workspace and file tree, open files and which one is showing, panels, the current view                                                                                                                |
| A long-lived service the component tree talks to                       | **React context** with a provider                                                                                      | `ArduinoProvider` (the tinyService client), `SerialProvider` (the port connection), the theme                                                                                                             |
| State owned by a subsystem that isn't React and outlives any component | **A module store**: plain module state, a `subscribe` function and a snapshot getter, read with `useSyncExternalStore` | `lib/agentChat.ts` (the Studio AI conversation), `lib/serialBus.ts` (recent serial lines), `circuit/parts/tinypartsSync.ts` (parts sync status), `circuit/core/store.ts` (a circuit and its undo history) |
| State only one component reads                                         | **`useState` / `useRef`**                                                                                              | a dialog's text field, a hover                                                                                                                                                                            |

## Rules

- **No state on `window`.** Share it through a module store instead. (The exported
  Visual page in `lib/visualExport.ts` is the exception: it's a standalone HTML
  file, not part of the app.)
- **Every `localStorage` key goes in `lib/storageKeys.ts`.** Renaming a key loses
  what people saved under it, so a rename needs a migration; see the theme key in
  `lib/ThemeProvider.tsx`.
- **Don't copy Redux state into a module store, or the other way round.** If two
  places need it, one owns it and the other reads it.
- **Keep high-frequency editor state out of Redux.** The circuit editor updates on
  every pointer move and needs its own undo history, so `CircuitDocument` holds it
  and the view subscribes to its revision counter.
- **Components call actions, not the store's internals.** File and project actions
  are functions in `commands/fileCommands.ts`; the Arduino service is reached
  through its context.
