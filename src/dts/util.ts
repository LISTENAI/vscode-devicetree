/*
 * Copyright (c) 2020 Trond Snekvik
 *
 * SPDX-License-Identifier: MIT
 */
import * as vscode from 'vscode';

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

export function sizeString(size: number): string {
  const spec = [
    { size: 1024 * 1024 * 1024, name: 'GB' },
    { size: 1024 * 1024, name: 'MB' },
    { size: 1024, name: 'KB' },
    { size: 1, name: '字节' },
  ].find(spec => Math.abs(size) >= spec.size && !(size % spec.size));

  if (size % spec!.size) {
    return (size / spec!.size).toFixed(3) + ' ' + spec!.name;
  }

  return (size / spec!.size).toString() + ' ' + spec!.name;
}

export function addressString(size: number, length?: number): string {
  let hex = size.toString(16).toUpperCase();
  if (typeof length === 'number') {
    hex = hex.padStart(length, '0');
  }
  return `0x${hex}`;
}
