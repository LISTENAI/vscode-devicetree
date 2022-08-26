import { commands, ExtensionContext, window, workspace } from 'vscode';
import { execa } from 'execa';
import { pathExists, readFile } from 'fs-extra';
import { getLisaWest, getSdk } from './lisa';
import { filter, map } from 'bluebird';
import { basename, dirname, join, normalize, resolve, sep } from 'path';
import { promisify } from 'util';
import { glob as _glob } from 'glob';
import * as yaml from 'js-yaml';

const glob = promisify(_glob);

const conf = workspace.getConfiguration();

export let zephyrRoot: string | undefined;
export let modules: Module[] = [];
export let boards: Record<string, Board> = {};
export let bindings: string[] = [];

let westExe: string | undefined;

export interface Module {
  name: string;
  path: string;
  boardRoot: string;
  dtsRoot: string;
}

export interface Board {
  identifier: string;
  arch: string;
  path: string;
  info?: Record<string, any>;
}

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
  if (zephyrRoot) {
    await loadModules();
    await loadBoards();
    await loadBindings();
  }
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
    async () => await west('topdir'),
    async () => await west('config', 'zephyr.base'),
    async () => await getSdk(),
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

async function loadModules(): Promise<void> {
  const modulePaths = (await west('list', '-f', '{posixpath}'))?.split(/\r?\n/).map(line => line.trim()) || [];
  modules = await map(modulePaths, async (path) => {
    const mod = <Module>{
      name: basename(path),
      path: path,
      boardRoot: resolve(path, 'boards'),
      dtsRoot: resolve(path, 'dts'),
    };

    const metaPath = join(path, 'zephyr', 'module.yml');
    if (await pathExists(metaPath)) {
      const meta = await readYaml<ModuleData>(metaPath);
      const { settings } = meta.build || {};
      if (settings?.board_root) {
        mod.boardRoot = resolve(path, settings?.board_root);
      }
      if (settings?.dts_root) {
        mod.dtsRoot = resolve(path, settings?.dts_root);
      }
    }

    return mod;
  });
  console.log(`Found ${modules.length} modules`);
}

async function loadBoards(): Promise<void> {
  const boardRoots = await filter(modules.map(({ boardRoot }) => boardRoot), pathExists);
  const foundBoards = <Record<string, Board>>{};
  for (const root of boardRoots) {
    for (const dts of await glob('**/*.dts', { cwd: root })) {
      const boardPath = normalize(dirname(dts));
      const id = basename(dts, '.dts');
      foundBoards[id] = {
        identifier: id,
        arch: boardPath.split(sep)[0],
        path: join(root, dts),
      };
    }
  }
  boards = foundBoards;
  console.log(`Found ${Object.keys(boards).length} boards`);
}

async function loadBindings(): Promise<void> {
  const bindingRoots = await filter(modules.map(({ dtsRoot }) => join(dtsRoot, 'bindings')), pathExists);
  const foundBindings = <string[]>[];
  for (const root of bindingRoots) {
    for (const binding of await glob('**/*.yaml', { cwd: root })) {
      foundBindings.push(join(root, binding));
    }
  }
  bindings = foundBindings;
  console.log(`Found ${Object.keys(bindings).length} bindings`);
}

export async function resolveBoardInfo(board: Board): Promise<void> {
  const metaFile = join(dirname(board.path), `${board.identifier}.yaml`);
  if (!(await pathExists(metaFile))) {
    console.error(`Metadata for board '${board.identifier}' not found`);
    return;
  }

  board.info = await readYaml(metaFile);
}

export async function findIncludes(board?: string): Promise<string[]> {
  const includeDirs = [
    'include',
    'dts',
    'dts/common',
  ];
  if (board && boards[board]) {
    includeDirs.push(`dts/${boards[board].arch}`);
  }

  const includes = modules.flatMap((m) => includeDirs.map((p) => resolve(m.path, p)));
  return await filter(includes, pathExists);
}

async function readYaml<T>(path: string): Promise<T> {
  return <T>yaml.load(await readFile(path, 'utf-8'), { json: true });
}

interface ModuleData {
  build?: {
    settings?: Record<string, string>;
  };
}
