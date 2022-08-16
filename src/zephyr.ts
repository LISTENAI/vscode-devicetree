import { commands, ExtensionContext, window, workspace } from 'vscode';
import { execa } from 'execa';
import { pathExists } from 'fs-extra';
import { getLisaWest, getSdk } from './lisa';

const conf = workspace.getConfiguration();

export let zephyrRoot: string;
export let modules: string[];

let westExe: string;

export async function activate(context: ExtensionContext): Promise<void> {
  await loadEverything();
  context.subscriptions.push(workspace.onDidChangeConfiguration(async (e) => {
    if (e.affectsConfiguration('deviceTree.west') || e.affectsConfiguration('deviceTree.zephyr')) {
      await loadEverything();
    }
  }));
}

async function loadEverything(): Promise<void> {
  await findWest();
  await findZephyrRoot();
}

async function findWest(): Promise<void> {
  const candidates = [
    conf.get<string>('deviceTree.west'),
    getLisaWest(),
  ];

  for (const west of candidates) {
    if (!west) {
      continue;
    }

    try {
      const { stdout } = await execa(west as string, ['--version']);
      const match = stdout.match(/v\d+\.\d+\.\d+/);
      if (match) {
        westExe = west as string;
        console.log(`Found west version ${match[0]}: ${west}`);
        return;
      }
    } catch (e) {
      console.error(e);
    }
  }

  await window.showErrorMessage('Could not find west', 'Configure west path...');
  commands.executeCommand('workbench.action.openSettings', 'deviceTree.west');
}

async function findZephyrRoot(): Promise<void> {
  const candidates = [
    async () => conf.get<string>('deviceTree.zephyr'),
    async () => process.env['ZEPHYR_BASE'],
    async () => await getSdk(),
    async () => await west('topdir'),
    async () => await west('config', 'zephyr.base'),
  ];

  for (const getZephyr of candidates) {
    try {
      const zephyr = await getZephyr();
      if (zephyr && await pathExists(zephyr)) {
        zephyrRoot = zephyr;
        console.log(`Found Zephyr root: ${zephyrRoot}`);
        return;
      }
    } catch (e) {
      console.error(e);
    }
  }

  await window.showErrorMessage('Could not find Zephyr root', 'Configure...');
  commands.executeCommand('workbench.action.openSettings', 'deviceTree.zephyr');
}

async function west(...args: string[]): Promise<string | undefined> {
  if (!westExe) {
    return;
  }

  const cwd = zephyrRoot ?? workspace.workspaceFolders?.[0]?.uri.fsPath;
  const { stdout } = await execa(westExe, args, { cwd });
  return stdout;
}
