import { ProviderResult, TreeDataProvider, TreeItem, TreeItemCollapsibleState } from 'vscode';

export class DeviceTreeProvider implements TreeDataProvider<DeviceTreeItem>{
  getTreeItem(element: DeviceTreeItem): TreeItem | Thenable<TreeItem> {
    return element;
  }

  getChildren(_element?: DeviceTreeItem | undefined): ProviderResult<DeviceTreeItem[]> {
    return Promise.resolve([
      new DeviceTreeItem('hello', TreeItemCollapsibleState.Collapsed),
      new DeviceTreeItem('world', TreeItemCollapsibleState.Collapsed),
    ]);
  }
}

class DeviceTreeItem extends TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }
}
