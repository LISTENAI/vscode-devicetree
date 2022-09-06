import { commands, env, ExtensionContext, Location, Selection, Uri, window, workspace } from 'vscode';
import { basename, dirname } from 'path';
import * as zephyr from './zephyr';
import { TypeLoader } from './dts/types';
import { ArrayValue, DTSCtx, Node, Parser, PHandle, Property } from './dts/dts';
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

    commands.registerCommand('devicetree.ctx.delete', (ctx?: DTSCtx) => {
      ctx = ctx ?? this.parser.currCtx;
      if (!ctx || !(ctx instanceof DTSCtx)) {
        return;
      }

      this.parser.removeCtx(ctx);
    });

    commands.registerCommand('devicetree.getMacro', async () => {
      const ctx = this.parser.currCtx;
      const selection = window.activeTextEditor?.selection;
      const uri = window.activeTextEditor?.document.uri;
      if (!ctx || !selection || !uri) {
        return;
      }

      const nodeMacro = (node: Node): string => {
        const labels = node.labels();
        if (labels.length) {
          return `DT_NODELABEL(${toCIdentifier(labels[0])})`;
        }

        const alias = ctx.node('/alias/')?.properties().find(p => p.pHandle?.is(node));
        if (alias?.pHandle) {
          return `DT_ALIAS(${toCIdentifier(alias.pHandle.val)})`;
        }

        const chosen = ctx.node('/chosen/')?.properties().find(p => p.pHandle?.is(node));
        if (chosen?.pHandle) {
          return `DT_CHOSEN(${toCIdentifier(chosen.pHandle.val)})`;
        }

        if (node.parent) {
          const parent = nodeMacro(node.parent);

          // better to do DT_PATH(a, b, c) than DT_CHILD(DT_CHILD(a, b), c)
          if (!parent.startsWith('DT_NODELABEL(')) {
            return `DT_PATH(${toCIdentifier(node.path.slice(1, node.path.length - 1).replace(/\//g, ', '))})`;
          }

          return `DT_CHILD(${parent}, ${toCIdentifier(node.fullName)})`;
        }

        return `DT_ROOT`;
      };

      const propMacro = (prop: Property): string | undefined => {
        // Selecting the property name
        if (prop.loc.range.contains(selection)) {
          if (prop.name === 'label') {
            return `DT_LABEL(${nodeMacro(prop.node)})`;
          }

          // Not generated for properties like #gpio-cells
          if (prop.name.startsWith('#')) {
            return;
          }

          return `DT_PROP(${nodeMacro(prop.node)}, ${toCIdentifier(prop.name)})`;
        }

        // Selecting a phandle. Should return the property reference, not the node or cell that's being pointed to,
        // so that if the value changes, the reference will still be valid.
        const val = prop.valueAt(selection.start, uri);
        if (val instanceof ArrayValue) {
          const cell = val.cellAt(selection.start, uri);
          if (!cell) {
            return;
          }

          if (cell instanceof PHandle) {
            if (prop.value.length > 1) {
              return `DT_PHANDLE_BY_IDX(${nodeMacro(prop.node)}, ${toCIdentifier(prop.name)}, ${prop.value.indexOf(val)})`;
            }

            return `DT_PHANDLE(${nodeMacro(prop.node)}, ${toCIdentifier(prop.name)})`;
          }

          if (prop.name === 'reg') {
            const valIdx = prop.value.indexOf(val);
            const cellIdx = val.val.indexOf(cell);
            const names = prop.cellNames(ctx);
            if (names?.length) {
              const name = names?.[valIdx % names.length]?.[cellIdx];
              if (name) {
                if (prop.regs?.length === 1) {
                  // Name is either size or addr
                  return `DT_REG_${name.toUpperCase()}(${nodeMacro(prop.node)})`;
                }

                // Name is either size or addr
                return `DT_REG_${name.toUpperCase()}_BY_IDX(${nodeMacro(prop.node)}, ${valIdx})`;
              }
            }
          }

          if (val.isNumberArray()) {
            const cellIdx = val.val.indexOf(cell);
            return `DT_PROP_BY_IDX(${nodeMacro(prop.node)}, ${prop.name}, ${cellIdx})`;
          }

          const names = prop.cellNames(ctx);
          if (names?.length) {
            const idx = val.val.indexOf(cell);
            if (idx >= 0) {
              return `DT_PROP(${nodeMacro(prop.node)}, ${toCIdentifier(prop.name)})`;
            }
          }
        }
      };

      let macro: string | undefined;
      const prop = ctx.getPropertyAt(selection.start, uri);
      if (prop) {
        macro = propMacro(prop);
      } else {
        const entry = ctx.getEntryAt(selection.start, uri);
        if (entry?.nameLoc.range.contains(selection.start)) {
          macro = nodeMacro(entry.node);
        }
      }

      if (macro) {
        await env.clipboard.writeText(macro);
        window.setStatusBarMessage(`已复制 "${macro}" 到剪贴簿`, 3000);
      }
    });

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

function toCIdentifier(name: string) {
  return name.toLowerCase().replace(/[@,-]/g, '_').replace(/[#&]/g, '');
}
