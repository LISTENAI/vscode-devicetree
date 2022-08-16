import { ExtensionContext, TextDocument, TextEditor, window } from 'vscode';
import * as zephyr from './zephyr';
import DTSViewProvider from './DTSViewProvider';
import DTSContext from './DTSContext';

const viewProvider = new DTSViewProvider();

export async function activate(context: ExtensionContext): Promise<void> {
  await zephyr.activate(context);

  window.registerTreeDataProvider('deviceTree', viewProvider);
  context.subscriptions.push(window.onDidChangeActiveTextEditor((e) => onDidChangeActiveTextEditor(e)));

  await Promise.all(window.visibleTextEditors.map((e) => onDidOpen(e.document)));
}

export function deactivate() {
  // Do nothing
}

async function onDidOpen(doc: TextDocument) {
  if (doc.uri.scheme === 'file' && doc.languageId === 'deviceTree') {
    const ctx = await DTSContext.load(doc.uri);
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
