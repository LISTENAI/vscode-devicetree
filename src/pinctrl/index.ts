import { basename, resolve } from 'path';
import { Node } from '../dts/dts';

export interface PinctrlParser {
  parse(node: Node): PinMux | undefined;
}

export interface PinMux {
  port: string;
  pin: number;
  func: number;
}

import ListenaiCskPinctrl from './listenai,csk-pinctrl';

export function getPinctrlParser(compatible: string): PinctrlParser | undefined {
  return {
    ['listenai,csk-pinctrl']: ListenaiCskPinctrl,
  }[compatible];
}

export function parsePinctrl(node: Node): PinMux | undefined {
  const parent = node.parent?.property('compatible')?.string;
  if (!parent) {
    return;
  }

  const parser = getPinctrlParser(parent);
  if (!parser) {
    return;
  }

  return parser.parse(node);
}
