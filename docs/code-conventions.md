# Code conventions

Small rules that keep the codebase consistent. Each one exists because the
alternative was tried and hurt.

## Reporting errors

Every failure lands in one of three places, chosen by who needs to know:

1. **Something the user did failed → a toast.** Saving, opening, compiling,
   uploading, signing in, creating a file: when the action the user just took
   didn't happen, tell them in the app. Use `reportError(title, error)` from
   `lib/notify.ts`: it shows an error toast with the message, records it in
   the status-bar bell and logs the full error to the console.

   ```ts
   try {
     await fileSystem.writeFile(path, content)
   } catch (e) {
     reportError('Could not save the file', e)
   }
   ```

   The title says what didn't happen in the user's words ("Could not save the
   file"), not what threw ("writeFile failed").

2. **A background failure → `console.warn` with context.** A watcher that
   couldn't start, a cache that didn't load, a retry that will happen anyway:
   the user has nothing to do, so don't interrupt them, but leave a line that
   says what failed and where, so a bug report is actionable:

   ```ts
   console.warn('Parts cache: could not load pack', packId, e)
   ```

   `console.error` is for the app's own bugs surfacing where they can't be
   handled: an error boundary, a main-process handler that has no window to
   report to.

3. **An error that is safe to ignore → an empty `catch` with a comment.** The
   comment names the case that lands there, so the next reader knows it was
   thought through:

   ```ts
   try {
     localStorage.setItem(KEY, value)
   } catch {
     /* private mode or a full quota: the preference just isn't remembered */
   }
   ```

A `catch` that does nothing and says nothing is a bug, whichever branch it
belongs to.

## Comments describe now

A comment explains what the code does and why it is the way it is. It doesn't
narrate what the code used to do or what was wrong before: that history lives
in `git log` and `git blame`, where it stays attached to the change that made
it. "Was 8 seconds, now event-driven" tells the next reader nothing they can
act on; "event-driven so a plug-in shows up at once" does.

## Shortcuts live in one list

Every keyboard shortcut is declared in `src/renderer/src/lib/shortcuts.ts`.
Handlers call `matches(event, id)` and tooltips render `keysOf(id)`, so the
Keyboard shortcuts dialog is always right and a binding is changed in one place.
