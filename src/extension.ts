import { commands, ExtensionContext, Location, Selection, Uri, window, workspace } from 'vscode';
import { basename, dirname } from 'path';
import * as zephyr from './zephyr';
import { TypeLoader } from './dts/types';
import { Parser } from './dts/dts';
import { DTSTreeView } from './treeView';

export async function activate(context: ExtensionContext): Promise<void> {
  await zephyr.activate(context);

  const engine = new DTSEngine();
  await engine.activate(context);
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

    commands.registerCommand('devicetree.goto', async (p: string, uri?: Uri) => {
      const ctx = uri ? this.parser.ctx(uri) : this.parser.currCtx;

      let loc: Location | undefined;
      if (p.endsWith('/')) {
        loc = [...ctx?.node(p)?.entries || []].pop()?.nameLoc;
      } else {
        loc = ctx?.node(dirname(p))?.property(basename(p))?.loc;
      }

      if (loc) {
        const doc = await workspace.openTextDocument(loc.uri);
        const editor = await window.showTextDocument(doc);
        editor.revealRange(loc.range);
        editor.selection = new Selection(loc.range.start, loc.range.start);
      }
    });

  }
}
