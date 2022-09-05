import { getCompatible, Node, PHandle, Property } from '../dts/dts';

export interface PinctrlParser {
  parse(node: Node): PinMux | undefined;
}

export interface Pinctrl {
  name: string;
  prop: Property;
  refs: PHandle[];
}

export interface PinMux {
  port: string;
  pin: number;
  func: number;
}

import ListenaiCskPinctrl from './listenai,csk-pinctrl';

export function getPinctrlParser(node: Node): PinctrlParser | undefined {
  return node.parent && {
    ['listenai,csk-pinctrl']: ListenaiCskPinctrl,
  }[getCompatible(node.parent) || ''];
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
    const pinctrlProp = node.property(`pinctrl-${i}`);
    if (!pinctrlProp?.pHandles) {
      continue;
    }

    pinctrls.push({
      name: pinctrlNames[i],
      prop: pinctrlProp,
      refs: pinctrlProp.pHandles,
    });
  }

  return pinctrls;
}
