import { pathExists, readJson } from 'fs-extra';
import { homedir } from 'os';
import { join } from 'path';

// TODO: 适配 LISA_HOME
const PLUGIN_HOME = join(homedir(), '.listenai', 'lisa-zephyr');

export function getLisaWest(): string {
  const binaryDir = join(PLUGIN_HOME, 'venv', process.platform === 'win32' ? 'Scripts' : 'bin');
  return join(binaryDir, 'west');
}

export async function getSdk(): Promise<string | undefined> {
  const configFile = join(PLUGIN_HOME, 'config.json');
  if (await pathExists(configFile)) {
    const config = await readJson(configFile) as { sdk?: string };
    return config.sdk;
  }
}
