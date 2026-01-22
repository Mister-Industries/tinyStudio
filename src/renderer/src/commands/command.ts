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

/**
 * CommandManager tracks command history for undo / redo
 *
 * Usage:
 * 1. import the commandManager from this file where you need to use it
 * 2. create Commands in your event handler
 * 3. call commandManager.executeCommand(Command)
 * 4. attach undo() and redo() to their respective buttons
 */
export class CommandManager {
  private history: UndoableCommand[] = []
  private undone: UndoableCommand[] = []

  executeCommand(command: UndoableCommand): void {
    command.execute()
    this.history.push(command)
    this.undone = [] // Clear redo stack
  }

  undo(): void {
    const command = this.history.pop()
    if (command) {
      command.undo()
      this.undone.push(command)
    }
  }

  redo(): void {
    const command = this.undone.pop()
    if (command) {
      command.execute()
      this.history.push(command)
    }
  }

  clearHistory(): void {
    this.history = []
    this.undone = []
  }

  undoAll(): void {
    while (this.history.length > 0) {
      this.undo()
    }
    this.undone = []
  }
}

export const commandManager = new CommandManager()
