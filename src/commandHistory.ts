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
  private readonly undoStack: { command: TCommand; before: number; after: number }[] = [];
  private readonly redoStack: { command: TCommand; before: number; after: number }[] = [];
  private revision = 0;
  private sequence = 0;

  getRevision(): number { return this.revision; }

  constructor(private readonly limit = 50) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Command history limit must be a positive integer.');
  }

  execute(command: TCommand): void {
    command.apply();
    this.recordApplied(command);
  }

  recordApplied(command: TCommand): void {
    const after = ++this.sequence;
    this.undoStack.push({ command, before: this.revision, after });
    this.revision = after;
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): TCommand | null {
    const entry = this.undoStack.at(-1);
    if (!entry) return null;
    const { command } = entry;
    command.revert();
    this.revision = entry.before;
    this.undoStack.pop();
    this.redoStack.push(entry);
    return command;
  }

  redo(): TCommand | null {
    const entry = this.redoStack.at(-1);
    if (!entry) return null;
    const { command } = entry;
    command.apply();
    this.redoStack.pop();
    this.revision = entry.after;
    this.undoStack.push(entry);
    return command;
  }

  clear(): void {
    this.revision = ++this.sequence;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  getState(): CommandHistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.command.label ?? null,
      redoLabel: this.redoStack.at(-1)?.command.label ?? null,
    };
  }
}
