import { EventEmitter, TreeDataProvider, TreeItem, TreeItemCollapsibleState } from 'vscode';
import DTSContext from './DTSContext';
import { BoardInfo } from './zephyr';

type DeviceTreeItem = DTSContext | StaticInfoTree | StaticInfoTreeItem;

export default class DTSViewProvider implements TreeDataProvider<DeviceTreeItem> {
  private contexts: Record<string, DTSContext> = {};

  private treeDataChange = new EventEmitter<void | DTSContext>();
  onDidChangeTreeData = this.treeDataChange.event;

  async getChildren(element?: DeviceTreeItem | undefined): Promise<DeviceTreeItem[] | undefined> {
    if (!element) {
      return Object.values(this.contexts);
    } else if (element instanceof DTSContext) {
      return [
        this.getOverviewTree(element.board),
      ];
    } else if (element instanceof StaticInfoTree) {
      return element.nodes;
    }
  }

  async getTreeItem(element: DeviceTreeItem): Promise<TreeItem> {
    if (element instanceof DTSContext) {
      return {
        label: element.board.name,
        description: element.board.identifier,
        collapsibleState: TreeItemCollapsibleState.Collapsed,
      };
    } else if (element instanceof StaticInfoTree) {
      return {
        label: element.name,
        collapsibleState: TreeItemCollapsibleState.Collapsed,
      };
    } else if (element instanceof StaticInfoTreeItem) {
      return {
        label: `${element.key}:`,
        description: element.value,
      };
    } else {
      return {};
    }
  }

  addContext(ctx: DTSContext) {
    this.contexts[ctx.board.identifier] = ctx;
    this.treeDataChange.fire();
  }

  private getOverviewTree(board: BoardInfo): StaticInfoTree {
    return new StaticInfoTree('Board', [
      new StaticInfoTreeItem('id', board.identifier),
      new StaticInfoTreeItem('name', board.name),
      new StaticInfoTreeItem('arch', board.arch),
    ]);
  }
}

class StaticInfoTree {
  constructor(
    readonly name: string,
    readonly nodes: StaticInfoTreeItem[],
  ) {
  }
}

class StaticInfoTreeItem {
  constructor(
    readonly key: string,
    readonly value: string,
  ) {
  }
}
