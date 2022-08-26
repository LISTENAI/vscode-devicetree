import { ExtensionContext, TextDocument, TextEditor, window } from 'vscode';
import * as zephyr from './zephyr';
import { TypeLoader } from './dts/types';
import { Parser } from './dts/dts';
import { DTSTreeView } from './treeView';

export async function activate(context: ExtensionContext): Promise<void> {
  await zephyr.activate(context);

  const engine = new DTSEngine();
  engine.activate(context);
}

export function deactivate() {
  // Do nothing
}

class DTSEngine {
  parser: Parser;
  types: TypeLoader;
  treeView: DTSTreeView;

  constructor() {
    this.types = new TypeLoader();
    this.parser = new Parser({}, [], this.types);
    this.treeView = new DTSTreeView(this.parser);
  }

  async activate(ctx: ExtensionContext): Promise<void> {
    await Promise.all(zephyr.bindings.map(file => this.types.addFile(file)));
    await this.parser.activate(ctx);
  }
}
