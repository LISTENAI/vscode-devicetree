import { commands, ExtensionContext, window } from 'vscode';

export function activate(context: ExtensionContext) {
  console.log('Congratulations, your extension "devicetree" is now active!');

  const disposable = commands.registerCommand('devicetree.helloWorld', () => {
    window.showInformationMessage('Hello World from LISA DeviceTree!');
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
}
