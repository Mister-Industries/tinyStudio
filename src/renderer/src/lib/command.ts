export interface Command {
  execute(): void
}

export interface UndoableCommand extends Command {
  undo(): void
}

/**
 * Utility command that batches multiple undoable commands into a single atomic operation.
 * All commands execute in sequence, and undo in reverse order.
 * This ensures that complex operations can be undone with a single undo action.
 */
export class BatchCommand implements UndoableCommand {
  constructor(private commands: UndoableCommand[]) {
    if (commands.length === 0) {
      throw new Error('BatchCommand requires at least one command')
    }
  }

  execute(): void {
    // Execute all commands in sequence
    this.commands.forEach((command) => command.execute())
  }

  undo(): void {
    // Undo all commands in reverse order
    this.commands
      .slice()
      .reverse()
      .forEach((command) => command.undo())
  }
}
