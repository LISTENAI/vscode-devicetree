/*
 * Copyright (c) 2020 Trond Snekvik
 *
 * SPDX-License-Identifier: MIT
 */
import * as vscode from 'vscode';

export function countText(count: number, text: string, plural?: string): string {
  if (!plural) {
    plural = text + 's';
  }

  let out = count.toString() + ' ';
  if (count === 1) {
    out += text;
  } else {
    out += plural;
  }

  return out;
}

export function capitalize(str: string): string {
  return str.replace(/([a-z])(\w+)/g, (word, first: string, rest: string) => {
    const acronyms = [
      'ADC', 'DAC', 'GPIO', 'SPI', 'I2C', 'RX', 'TX', 'DMA',
    ];
    if (acronyms.includes(word.toUpperCase())) {
      return word.toUpperCase();
    }
    return first.toUpperCase() + rest;
  });
}

export function evaluateExpr(expr: string, _start: vscode.Position) {
  expr = expr.trim().replace(/([\d.]+|0x[\da-f]+)[ULf]+/gi, '$1');
  let m: RegExpMatchArray | null;
  let level = 0;
  let text = '';
  while ((m = expr.match(/(?:(?:<<|>>|&&|\|\||[!=<>]=|[|&~^<>!=+/*-]|\s*|0x[\da-fA-F]+|[\d.]+|'.')\s*)*([()]?)/)) && m[0].length) {
    text += m[0].replace(/'(.)'/g, (_, char: string) => char.codePointAt(0)!.toString());
    if (m[1] === '(') {
      level++;
    } else if (m[1] === ')') {
      if (!level) {
        return undefined;
      }

      level--;
    }

    expr = expr.slice(m.index! + m[0].length);
  }

  try {
    return eval(text);
  } catch (e) {
    return undefined;
  }
}
