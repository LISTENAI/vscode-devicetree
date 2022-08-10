import { ExtensionContext, window } from 'vscode';
import { DeviceTreeProvider } from './DeviceTreeProvider';

export function activate(_context: ExtensionContext) {
  window.registerTreeDataProvider('deviceTree', new DeviceTreeProvider());
}

export function deactivate() {
}
