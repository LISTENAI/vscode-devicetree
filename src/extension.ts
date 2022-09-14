import * as vscode from 'vscode';
import { basename, dirname } from 'path';
import * as zephyr from './zephyr';
import { TypeLoader } from './dts/types';
import * as dts from './dts/dts';
import { DTSTreeView } from './treeView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await zephyr.activate(context);

  const engine = new DTSEngine();
  await engine.activate(context);
}

export function deactivate() {
  // Do nothing
}

class DTSEngine implements
  vscode.DocumentSymbolProvider,
  vscode.WorkspaceSymbolProvider,
  vscode.DocumentRangeFormattingEditProvider,
  vscode.DocumentLinkProvider,
  vscode.TypeDefinitionProvider {
  parser: dts.Parser;
  types: TypeLoader;
  treeView: DTSTreeView;

  constructor() {
    this.types = new TypeLoader();
    this.parser = new dts.Parser({}, [], this.types);
    this.treeView = new DTSTreeView(this.parser);
  }

  async activate(ctx: vscode.ExtensionContext): Promise<void> {
    await Promise.all(zephyr.bindings.map(file => this.types.addFile(file)));
    await this.parser.activate(ctx);

    const dtsFiles: vscode.DocumentFilter = { language: 'dts', scheme: 'file' };
    ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(dtsFiles, this));
    ctx.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(this));
    ctx.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider(dtsFiles, this));
    ctx.subscriptions.push(vscode.languages.registerDocumentLinkProvider(dtsFiles, this));
    ctx.subscriptions.push(vscode.languages.registerTypeDefinitionProvider(dtsFiles, this));

    vscode.commands.registerCommand('devicetree.ctx.delete', this.commandCtxDelete);
    vscode.commands.registerCommand('devicetree.getMacro', this.commandGetMacro);
    vscode.commands.registerCommand('devicetree.goto', this.commandGoto);
  }

  private commandCtxDelete(ctx?: dts.DTSCtx) {
    ctx = ctx ?? this.parser.currCtx;
    if (!ctx || !(ctx instanceof dts.DTSCtx)) {
      return;
    }

    this.parser.removeCtx(ctx);
  }

  private async commandGetMacro() {
    const ctx = this.parser.currCtx;
    const selection = vscode.window.activeTextEditor?.selection;
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!ctx || !selection || !uri) {
      return;
    }

    const nodeMacro = (node: dts.Node): string => {
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

    const propMacro = (prop: dts.Property): string | undefined => {
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
      if (val instanceof dts.ArrayValue) {
        const cell = val.cellAt(selection.start, uri);
        if (!cell) {
          return;
        }

        if (cell instanceof dts.PHandle) {
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
      await vscode.env.clipboard.writeText(macro);
      vscode.window.setStatusBarMessage(`已复制 "${macro}" 到剪贴簿`, 3000);
    }
  }

  private async commandGoto(p: string, uri?: vscode.Uri) {
    const ctx = uri ? this.parser.ctx(uri) : this.parser.currCtx;

    let loc: vscode.Location | undefined;
    if (p.endsWith('/')) {
      loc = [...ctx?.node(p)?.entries || []].pop()?.nameLoc;
    } else {
      loc = ctx?.node(dirname(p))?.property(basename(p))?.loc;
    }

    if (loc) {
      const doc = await vscode.workspace.openTextDocument(loc.uri);
      const editor = await vscode.window.showTextDocument(doc);
      editor.revealRange(loc.range);
      editor.selection = new vscode.Selection(loc.range.start, loc.range.start);
    }
  }

  provideDocumentSymbols(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
    const propSymbolKind = (p: dts.Property) => {
      if (p.name.startsWith('#')) {
        return vscode.SymbolKind.Number;
      }

      if (p.name === 'compatible') {
        return vscode.SymbolKind.TypeParameter;
      }
      if (p.name === 'status') {
        return vscode.SymbolKind.Event;
      }
      if (p.stringArray) {
        return vscode.SymbolKind.String;
      }
      if (p.bytestring) {
        return vscode.SymbolKind.Array;
      }
      if (p.pHandles) {
        return vscode.SymbolKind.Variable;
      }

      return vscode.SymbolKind.Property;
    };

    const symbols: vscode.SymbolInformation[] = [];

    const addSymbol = (e: dts.NodeEntry) => {
      if (e.loc.uri.toString() !== document.uri.toString()) {
        return;
      }

      const node = new vscode.SymbolInformation(e.node.fullName || '/', vscode.SymbolKind.Class, e.parent?.node?.fullName || '', e.loc);
      symbols.push(node);
      symbols.push(...e.properties.map(p => new vscode.SymbolInformation(p.name, propSymbolKind(p), e.node.fullName, p.loc)));
      e.children.forEach(addSymbol);
    };

    this.parser.ctx(document.uri)?.roots.forEach(addSymbol);
    return symbols;
  }

  provideWorkspaceSymbols(_query: string, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[]> {
    const ctx = this.parser.currCtx;
    if (!ctx) {
      return [];
    }

    return ctx.nodeArray()
      .filter(n => n.entries.length > 0)
      .map(n => new vscode.SymbolInformation(n.fullName || '/', vscode.SymbolKind.Class, n.parent?.path ?? '', n.entries[0].nameLoc));
  }

  getEntityDefinition(file: dts.DTSFile, uri: vscode.Uri, position: vscode.Position): dts.Node | dts.Property | undefined {
    const entry = file.getEntryAt(position, uri);
    if (!entry) {
      return;
    }

    if (entry.nameLoc.uri.toString() === uri.toString() && entry.nameLoc.range.contains(position)) {
      return entry.node;
    }

    const prop = entry.getPropertyAt(position, uri);
    if (!prop) {
      return;
    }

    if (prop.loc.uri.toString() === uri.toString() && prop.loc.range.contains(position)) {
      return prop;
    }

    const val = prop.valueAt(position, uri);
    if (val instanceof dts.PHandle) {
      return file.ctx.node(val.val);
    }

    if (val instanceof dts.ArrayValue) {
      const cell = val.cellAt(position, uri);
      if (cell instanceof dts.PHandle) {
        return file.ctx.node(cell.val);
      }
    }
  }

  async provideTypeDefinition(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.Location | undefined> {
    const file = this.parser.file(document.uri);
    if (!file) {
      return;
    }

    let typeFile: string | undefined;
    let range = new vscode.Range(0, 0, 0, 0);

    const entity = this.getEntityDefinition(file, document.uri, position);
    if (entity instanceof dts.Node) {
      typeFile = entity?.type?.filename;
    } else if (entity instanceof dts.Property) {
      // fetch the node of the original property declaration if available:
      typeFile = entity.node.type?.property(entity.name)?.node?.filename ?? entity.node.type?.filename;
      if (typeFile) {
        // Try a best effort search for the property name within the type file. If it fails, we'll
        // fall back to just opening the file.
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(typeFile));
        if (!doc) {
          return;
        }

        // This is a pretty optimistic regex, but it removes most mentions from comments and descriptions:
        const offset = doc.getText().match(new RegExp(`(${entity.name}|"${entity.name}")\\s*:`))?.index;
        if (offset !== undefined) {
          range = doc.getWordRangeAtPosition(doc.positionAt(offset))!;
        }
      }
    }

    if (typeFile) {
      return new vscode.Location(vscode.Uri.file(typeFile), range);
    }
  }

  provideDocumentRangeFormattingEdits(document: vscode.TextDocument, r: vscode.Range, options: vscode.FormattingOptions, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
    let text = document.getText();
    let start = document.offsetAt(r.start);
    let end = document.offsetAt(r.end);
    start = text.slice(0, start).lastIndexOf(';') + 1;
    end += text.slice(end - 1).indexOf(';') + 1;
    if (end < start) {
      end = text.length - 1;
    }

    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

    const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
    text = document.getText(range);
    const firstLine = document.getText(new vscode.Range(range.start.line, 0, range.start.line, 99999));
    let indent = firstLine?.match(/^\s*/)?.[0];

    text = text.replace(/([\w,-]+)\s*:[\t ]*/g, '$1: ');
    text = text.replace(/(&[\w,-]+)\s*{[\t ]*/g, '$1 {');
    text = text.replace(/([\w,-]+)@0*([\da-fA-F]+)\s*{[\t ]*/g, '$1@$2 {');
    text = text.replace(/(\w+)\s*=\s*(".*?"|<.*?>|\[.*?\])\s*;/g, '$1 = $2;');
    text = text.replace(/<\s*(.*?)\s*>/g, '<$1>');
    text = text.replace(/([;{])[ \t]+\r?\n/g, '$1' + eol);
    text = text.replace(/\[\s*((?:[\da-fA-F]{2}\s*)+)\s*\]/g, (_, contents: string) => `[ ${contents.replace(/([\da-fA-F]{2})\s*/g, '$1 ')} ]`);
    text = text.replace(/[ \t]+\r?\n/g, eol);

    // convert tabs to spaces to get the right line width:
    text = text.replace(/\t/g, ' '.repeat(options.tabSize));

    const indentStep = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
    if (options.insertSpaces) {
      text = text.replace(/^\t+/g, tabs => indentStep.repeat(tabs.length));
    } else {
      text = text.replace(new RegExp(`^( {${options.tabSize}})+`, 'gm'), spaces => '\t'.repeat(spaces.length / options.tabSize));
    }

    // indentation
    let commaIndent = '';
    text = text.split(/\r?\n/).map(line => {
      if (line.length === 0) {
        return line;
      }

      const delta = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      if (delta < 0) {
        indent = indent?.slice(indentStep.repeat(-delta).length);
      }
      const retval = line.replace(/^[ \t]*/g, indent + commaIndent);
      if (delta > 0) {
        indent += indentStep.repeat(delta);
      }

      // property values with commas should all have the same indentation
      if (commaIndent.length === 0 && line.endsWith(',')) {
        commaIndent = ' '.repeat(line.replace(/\t/g, ' '.repeat(options.tabSize)).indexOf('=') + 2 - (indent?.replace(/\t/g, ' '.repeat(options.tabSize))?.length || 0));

        if (!options.insertSpaces) {
          commaIndent = commaIndent.replace(new RegExp(' '.repeat(options.tabSize), 'g'), '\t');
        }
      } else if (line.endsWith(';')) {
        commaIndent = '';
      }

      return retval;
    }).join(eol);


    // move comma separated property values on new lines:
    text = text.replace(/([ \t]*)([#\w-]+)\s*=((?:\s*(?:".*?"|<.*?>|\[.*?\])[ \t]*,?\s*(\/\*.*?\*\/)?\s*)+);/gm, (line: string, indentation: string, p: string, val: string) => {
      if (line.length < 80) {
        return line;
      }

      const regex = new RegExp(/((?:".*?"|<.*?>|\[.*?\])[ \t]*,?)[ \t]*(\/\*.*?\*\/)?/gm);
      const parts = [];
      let entry: RegExpMatchArray | null;
      while ((entry = regex.exec(val))) {
        if (entry[2]) {
          parts.push(entry[1] + ' ' + entry[2]);
        } else {
          parts.push(entry[1]);
        }
      }

      if (!parts.length) {
        return line;
      }

      const start = `${indentation}${p} = `;
      return start + parts.map(p => p.trim()).join(`${eol}${indentation}${' '.repeat(p.length + 3)}`) + ';';
    });

    // The indentation stuff broke multiline comments. The * on the follow up lines must align with the * in /*:
    text = text.replace(/\/\*[\s\S]*?\*\//g, content => {
      return content.replace(/^([ \t]*)\*/gm, '$1 *');
    });

    return [new vscode.TextEdit(range, text)];
  }

  async provideDocumentLinks(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.DocumentLink[]> {
    await this.parser.stable();
    return this.parser.file(document.uri)?.includes.filter(i => i.loc.uri.fsPath === document.uri.fsPath).map(i => {
      const link = new vscode.DocumentLink(i.loc.range, i.dst);
      link.tooltip = i.dst.fsPath;
      return link;
    }) ?? [];
  }
}

function toCIdentifier(name: string) {
  return name.toLowerCase().replace(/[@,-]/g, '_').replace(/[#&]/g, '');
}
