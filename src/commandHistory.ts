export interface ReversibleCommand {
  readonly label: string;
  apply(): void;
  revert(): void;
}

export interface CommandHistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

export class CommandHistory<TCommand extends ReversibleCommand = ReversibleCommand> {
  private readonly undoStack: TCommand[] = [];
  private readonly redoStack: TCommand[] = [];

  constructor(private readonly limit = 50) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Command history limit must be a positive integer.');
  }

  execute(command: TCommand): void {
    command.apply();
    this.recordApplied(command);
  }

  recordApplied(command: TCommand): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): TCommand | null {
    const command = this.undoStack.at(-1);
    if (!command) return null;
    command.revert();
    this.undoStack.pop();
    this.redoStack.push(command);
    return command;
  }

  redo(): TCommand | null {
    const command = this.redoStack.at(-1);
    if (!command) return null;
    command.apply();
    this.redoStack.pop();
    this.undoStack.push(command);
    return command;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  getState(): CommandHistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
    };
  }
}
