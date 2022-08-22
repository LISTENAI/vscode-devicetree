import { ExtensionContext, TextDocument, TextEditor, window } from 'vscode';
import * as zephyr from './zephyr';
import DTSViewProvider from './DTSViewProvider';
import DTSContext from './DTSContext';
import { TypeLoader } from './dts/types';
import { Parser } from './dts/dts';

const viewProvider = new DTSViewProvider();

const types = new TypeLoader();
const parser = new Parser({}, [], types);

export async function activate(context: ExtensionContext): Promise<void> {
  await zephyr.activate(context);
  await Promise.all(zephyr.bindings.map(file => types.addFile(file)));
  await parser.activate(context);

  window.registerTreeDataProvider('deviceTree', viewProvider);
  context.subscriptions.push(window.onDidChangeActiveTextEditor((e) => onDidChangeActiveTextEditor(e)));

  await Promise.all(window.visibleTextEditors.map((e) => onDidOpen(e.document)));
}

export function deactivate() {
  // Do nothing
}

async function onDidOpen(doc: TextDocument) {
  if (doc.uri.scheme === 'file' && doc.languageId === 'deviceTree') {
    const ctx = await DTSContext.load(doc.uri, parser);
    if (ctx) {
      viewProvider.addContext(ctx);
    }
  }
}

async function onDidChangeActiveTextEditor(editor?: TextEditor) {
  if (editor?.document) {
    onDidOpen(editor.document);
  }
}
