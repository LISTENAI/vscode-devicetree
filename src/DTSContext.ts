import { basename, normalize, sep } from 'path';
import { Uri } from 'vscode';
import { Parser } from './dts/dts';
import { BoardInfo, resolveBoard } from './zephyr';

export default class DTSContext {
  static async load(uri: Uri, parser: Parser): Promise<DTSContext | undefined> {
    const path = normalize(uri.fsPath);

    const id = fromBoard(path) || fromOverlay(path);
    if (!id) {
      return;
    }

    const board = await resolveBoard(id);
    if (!board) {
      return;
    }

    console.log(`Loaded context for board: ${id}`);

    return new DTSContext(board, parser);
  }

  private constructor(
    public readonly board: BoardInfo,
    public readonly parser: Parser,
  ) {
    console.log(parser);
  }
}

function fromBoard(path: string): string | undefined {
  if (path.split(sep).includes('boards') && path.endsWith('.dts')) {
    return basename(path, '.dts');
  }
}

function fromOverlay(path: string): string | undefined {
  if (path.split(sep).includes('boards') && path.endsWith('.overlay')) {
    return basename(path, '.overlay');
  }
}
