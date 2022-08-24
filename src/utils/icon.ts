import { TreeItem } from 'vscode';

export default function icon(name: string): TreeItem['iconPath'] {
  return {
    dark: __dirname + `/../icons/dark/${name}.svg`,
    light: __dirname + `/../icons/light/${name}.svg`,
  };
}
