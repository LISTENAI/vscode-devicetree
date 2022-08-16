import { ExtensionContext, window } from 'vscode';
import { DeviceTreeProvider } from './DeviceTreeProvider';
import * as zephyr from './zephyr';

export async function activate(context: ExtensionContext): Promise<void> {
  window.registerTreeDataProvider('deviceTree', new DeviceTreeProvider());
  await zephyr.activate(context);
}

export function deactivate() {
}
