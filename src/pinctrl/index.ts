import { getCompatible, Node } from '../dts/dts';

export interface PinctrlParser {
  parse(node: Node): PinMux | undefined;
}

export interface Pinctrl {
  name: string;
  path: string;
  refs: string[];
}

export interface PinMux {
  port: string;
  pin: number;
  func: number;
}

import ListenaiCskPinctrl from './listenai,csk-pinctrl';

export function getPinctrlParser(node: Node): PinctrlParser | undefined {
  return {
    ['listenai,csk-pinctrl']: ListenaiCskPinctrl,
  }[getCompatible(node) || ''];
}

export function parsePinctrl(node: Node): PinMux | undefined {
  return getPinctrlParser(node)?.parse(node);
}

export function getPinctrls(node: Node): Pinctrl[] | undefined {
  const pinctrlNames = node.property('pinctrl-names')?.stringArray;
  if (!pinctrlNames) {
    return;
  }

  const pinctrls: Pinctrl[] = [];
  for (let i = 0; i < pinctrlNames.length; i++) {
    const pinctrlNode = node.property(`pinctrl-${i}`);
    if (!pinctrlNode?.pHandles) {
      continue;
    }

    pinctrls.push({
      name: pinctrlNames[i],
      path: pinctrlNode.path,
      refs: pinctrlNode.pHandles.map((ref) => ref.val),
    });
  }

  return pinctrls;
}
