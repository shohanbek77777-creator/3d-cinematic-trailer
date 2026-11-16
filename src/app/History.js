// Snapshot-based undo / redo. Each committed edit stores the serialized project.
export class History {
  constructor(limit = 120) {
    this.limit = limit;
    this.stack = [];
    this.index = -1;
    this.onChange = null;
  }
  reset(snapshot) {
    this.stack = [{ json: snapshot, label: 'Initial' }];
    this.index = 0;
    this.onChange?.();
  }
  push(json, label = 'Edit') {
    if (this.index >= 0 && this.stack[this.index].json === json) return false;
    this.stack.length = this.index + 1;
    this.stack.push({ json, label });
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    this.onChange?.();
    return true;
  }
  get canUndo() {
    return this.index > 0;
  }
  get canRedo() {
    return this.index < this.stack.length - 1;
  }
  undo() {
    if (!this.canUndo) return null;
    const label = this.stack[this.index].label;
    this.index--;
    this.onChange?.();
    return { json: this.stack[this.index].json, label };
  }
  redo() {
    if (!this.canRedo) return null;
    this.index++;
    this.onChange?.();
    return { json: this.stack[this.index].json, label: this.stack[this.index].label };
  }
}
