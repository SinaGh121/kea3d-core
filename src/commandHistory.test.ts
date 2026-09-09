import { describe, expect, it } from 'vitest';
import { CommandHistory, type ReversibleCommand } from './commandHistory';

function setValueCommand(state: { value: number }, value: number, label = `Set ${value}`): ReversibleCommand {
  const previous = state.value;
  return {
    label,
    apply: () => { state.value = value; },
    revert: () => { state.value = previous; },
  };
}

describe('command history', () => {
  it('keeps view motion undoable without hiding real unsaved edits', () => {
    const history = new CommandHistory();
    const state = { value: 0 };
    const saved = history.getRevision();
    history.execute({ ...setValueCommand(state, 1), affectsDocument: false });
    expect(history.getRevision()).toBe(saved);
    history.execute(setValueCommand(state, 2));
    const edited = history.getRevision();
    expect(edited).not.toBe(saved);
    history.execute({ ...setValueCommand(state, 3), affectsDocument: false });
    expect(history.getRevision()).toBe(edited);
    history.undo();
    expect(state.value).toBe(2);
    expect(history.getRevision()).toBe(edited);
    history.undo();
    expect(history.getRevision()).toBe(saved);
    history.redo();
    expect(history.getRevision()).toBe(edited);
  });
  it('restores checkpoints and never reuses a discarded branch revision', () => {
    const history = new CommandHistory();
    const command = { label: 'Reusable', apply() {}, revert() {} };
    const initial = history.getRevision();
    history.execute(command);
    const first = history.getRevision();
    history.execute(command);
    const second = history.getRevision();
    history.undo();
    expect(history.getRevision()).toBe(first);
    history.undo();
    expect(history.getRevision()).toBe(initial);
    history.redo();
    expect(history.getRevision()).toBe(first);
    history.execute(command);
    expect(history.getRevision()).not.toBe(second);
    history.clear();
    expect(history.getRevision()).toBeGreaterThan(second);
  });

  it('executes, undoes, and redoes reversible commands', () => {
    const state = { value: 1 };
    const history = new CommandHistory();

    history.execute(setValueCommand(state, 2, 'Change value'));
    expect(state.value).toBe(2);
    expect(history.getState()).toEqual({ canUndo: true, canRedo: false, undoLabel: 'Change value', redoLabel: null });

    expect(history.undo()?.label).toBe('Change value');
    expect(state.value).toBe(1);
    expect(history.getState()).toEqual({ canUndo: false, canRedo: true, undoLabel: null, redoLabel: 'Change value' });

    expect(history.redo()?.label).toBe('Change value');
    expect(state.value).toBe(2);
  });

  it('records an already-applied preview and clears redo after a new command', () => {
    const state = { value: 0 };
    const history = new CommandHistory();
    const preview = setValueCommand(state, 1, 'Previewed change');
    preview.apply();
    history.recordApplied(preview);
    history.undo();
    expect(history.getState().canRedo).toBe(true);

    history.execute(setValueCommand(state, 3));
    expect(state.value).toBe(3);
    expect(history.getState().canRedo).toBe(false);
  });

  it('keeps only the configured number of undo entries', () => {
    const state = { value: 0 };
    const history = new CommandHistory(2);
    history.execute(setValueCommand(state, 1));
    history.execute(setValueCommand(state, 2));
    history.execute(setValueCommand(state, 3));

    history.undo();
    history.undo();
    expect(state.value).toBe(1);
    expect(history.undo()).toBeNull();
  });

  it('does not move a command when applying or reverting throws', () => {
    const applyFailure = new CommandHistory();
    expect(() => applyFailure.execute({ label: 'Fail apply', apply: () => { throw new Error('apply'); }, revert: () => undefined })).toThrow('apply');
    expect(applyFailure.getState().canUndo).toBe(false);

    const revertFailure = new CommandHistory();
    revertFailure.recordApplied({ label: 'Fail revert', apply: () => undefined, revert: () => { throw new Error('revert'); } });
    expect(() => revertFailure.undo()).toThrow('revert');
    expect(revertFailure.getState()).toMatchObject({ canUndo: true, canRedo: false });
  });
});
