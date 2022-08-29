/*
 * Copyright (c) 2020 Trond Snekvik
 *
 * SPDX-License-Identifier: MIT
 */
import * as vscode from 'vscode';
import { basename } from 'path';
import { DTSCtx, DTSFile, Node, Parser, PHandle, Property } from './dts/dts';
import { addressString, sizeString } from './dts/util';
import { resolveBoardInfo } from './zephyr';
import icon from './utils/icon';

class TreeInfoItem {
    ctx: DTSCtx;
    name: string;
    icon?: string;
    parent?: TreeInfoItem;
    path?: string;
    description?: string;
    tooltip?: string;
    private _children: TreeInfoItem[];

    constructor(ctx: DTSCtx, name: string, icon?: string, description?: string) {
        this.ctx = ctx;
        this.name = name;
        this.icon = icon;
        this.description = description;
        this._children = [];
    }

    get children(): ReadonlyArray<TreeInfoItem> {
        return this._children;
    }

    get id(): string {
        if (this.parent) {
            return `${this.parent.id}.${this.name}(${this.description ?? ''})`;
        }
        return this.name;
    }

    addChild(child: TreeInfoItem | undefined) {
        if (child) {
            child.parent = this;
            this._children.push(child);
        }
    }
}

type NestedInclude = { uri: vscode.Uri, file: DTSFile };
type DTSTreeItem = DTSCtx | DTSFile | NestedInclude | TreeInfoItem;

export class DTSTreeView implements
    vscode.TreeDataProvider<DTSTreeItem> {
    parser: Parser;
    treeView: vscode.TreeView<DTSTreeItem>;
    private treeDataChange: vscode.EventEmitter<void | DTSCtx>;
    onDidChangeTreeData: vscode.Event<void | DTSCtx>;

    constructor(parser: Parser) {
        this.parser = parser;

        this.treeDataChange = new vscode.EventEmitter<void | DTSCtx>();
        this.onDidChangeTreeData = this.treeDataChange.event;

        this.parser.onChange(_ctx => this.treeDataChange.fire());
        this.parser.onDelete(_ctx => this.treeDataChange.fire());

        this.treeView = vscode.window.createTreeView('listenai.devicetree.ctx', { showCollapseAll: true, canSelectMany: false, treeDataProvider: this });

        vscode.window.onDidChangeActiveTextEditor(e => {
            if (!e || !this.treeView.visible || !e.document) {
                return;
            }

            const file = this.parser.file(e.document.uri);
            if (file) {
                this.treeView.reveal(file);
            }
        });
    }

    update() {
        this.treeDataChange.fire();
    }


    private treeFileChildren(file: DTSFile, uri: vscode.Uri) {
        return file.includes
            .filter(i => i.loc.uri.toString() === uri.toString())
            .map(i => (<NestedInclude>{ uri: i.dst, file }));
    }

    async getTreeItem(element: DTSTreeItem): Promise<vscode.TreeItem> {
        await this.parser.stable();
        try {
            if (element instanceof DTSCtx) {
                let file: DTSFile | undefined;
                if (element.overlays.length) {
                    file = element.overlays[element.overlays.length - 1];
                } else {
                    file = element.boardFile;
                }

                if (!file) {
                    return {};
                }

                const item = new vscode.TreeItem(element.name,
                    this.parser.currCtx === element ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
                item.contextValue = 'devicetree.ctx';
                item.tooltip = '设备树上下文';
                item.id = ['devicetree', 'ctx', element.name, 'file', file.uri.fsPath.replace(/[/\\]/g, '.')].join('.');
                item.iconPath = icon('devicetree-inner');
                return item;
            }

            if (element instanceof DTSFile) {
                const item = new vscode.TreeItem(basename(element.uri.fsPath));
                if (element.includes.length) {
                    item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                }
                item.resourceUri = element.uri;
                item.command = { command: 'vscode.open', title: 'Open file', arguments: [element.uri] };
                item.id === ['devicetree', 'file', element.ctx.name, element.uri.fsPath.replace(/[/\\]/g, '.')].join('.');
                if (element.ctx.boardFile === element) {
                    item.iconPath = icon('circuit-board');
                    item.tooltip = '板型文件';
                    item.contextValue = 'devicetree.board';
                } else {
                    if (element.ctx.overlays.indexOf(element) === element.ctx.overlays.length - 1) {
                        item.iconPath = icon('overlay');
                        item.contextValue = 'devicetree.overlay';
                    } else {
                        item.iconPath = icon('shield');
                        item.contextValue = 'devicetree.shield';
                    }
                    item.tooltip = '概览';
                }
                return item;
            }

            if (element instanceof TreeInfoItem) {
                const item = new vscode.TreeItem(element.name, element.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
                item.description = element.description;
                item.id = ['devicetree', 'ctx', element.ctx.name, 'item', element.id].join('.');
                if (element.icon) {
                    item.iconPath = icon(element.icon);
                }

                if (element.tooltip) {
                    item.tooltip = element.tooltip;
                }

                if (element.path) {
                    item.command = {
                        command: 'devicetree.goto',
                        title: 'Show',
                        arguments: [element.path, element.ctx.files.pop()?.uri]
                    };
                }

                return item;
            }

            // Nested include
            const item = new vscode.TreeItem(basename(element.uri.fsPath));
            item.resourceUri = element.uri;
            if (this.treeFileChildren(element.file, element.uri).length) {
                item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            }
            item.iconPath = vscode.ThemeIcon.File;
            item.description = '- include';
            item.command = { command: 'vscode.open', title: 'Open file', arguments: [element.uri] };
            return item;
        } catch (e) {
            console.log(e);
        }
        return {};
    }

    getChildren(element?: DTSTreeItem): vscode.ProviderResult<DTSTreeItem[]> {
        try {
            if (!element) {
                return this.parser.contexts;
            }

            if (element instanceof DTSCtx) {
                return this.getOverviewTree(element);
            }

            if (element instanceof DTSFile) {
                return this.treeFileChildren(element, element.uri);
            }

            if (element instanceof TreeInfoItem) {
                return Array.from(element.children);
            }

            // Nested include:
            return this.treeFileChildren(element.file, element.uri);
        } catch (e) {
            console.log(e);
            return [];
        }
    }

    private async boardOverview(ctx: DTSCtx) {
        const board = new TreeInfoItem(ctx, '板型', 'circuit-board');

        if (!ctx.board) {
            return;
        }

        if (!ctx.board.info) {
            await resolveBoardInfo(ctx.board);
            if (!ctx.board.info) {
                return;
            }
        }

        Object.entries({
            name: '名称:',
            arch: '架构:',
        }).forEach(([field, name]) => {
            if (field === 'name') {
                const model = ctx.root?.property('model')?.string;
                if (model) {
                    board.addChild(new TreeInfoItem(ctx, name, undefined, model));
                    return;
                }
            }

            if (ctx.board?.info?.[field]) {
                const item = new TreeInfoItem(ctx, name, undefined);
                if (Array.isArray(ctx.board.info[field])) {
                    (<string[]>ctx.board.info[field]).forEach(i => item.addChild(new TreeInfoItem(ctx, i)));
                } else {
                    item.description = ctx.board.info[field].toString();
                }

                board.addChild(item);
            }
        });

        board.addChild(this.rootRefsOverview('chosen', ctx));
        board.addChild(this.rootRefsOverview('aliases', ctx));

        return board;
    }

    private gpioOverview(ctx: DTSCtx) {
        const gpio = new TreeInfoItem(ctx, 'GPIO', 'gpio');
        ctx.nodeArray().filter(n => n.pins).forEach((n, _, _all) => {
            const controller = new TreeInfoItem(ctx, n.uniqueName);
            n.pins?.forEach((p, i) => {
                if (p) {
                    const pin = new TreeInfoItem(ctx, `Pin ${i.toString()}`);
                    pin.path = p.prop.path;
                    pin.tooltip = p.prop.node.type?.description;
                    if (p.pinmux) {
                        const name = p.pinmux.name
                            .replace((p.prop.node.labels()[0] ?? p.prop.node.name) + '_', '')
                            .replace(/_?p[a-zA-Z]\d+$/, '');
                        pin.description = `${p.prop.node.uniqueName} • ${name}`;
                    } else {
                        pin.description = `${p.prop.node.uniqueName} • ${p.prop.name}`;
                    }
                    controller.addChild(pin);
                }
            });

            controller.path = n.path;
            controller.description = n.pins!.length + ' 个引脚';
            controller.tooltip = n.type?.description;
            if (!controller.children.length) {
                controller.description += ' • 没有连接';
            } else if (controller.children.length < n.pins!.length) {
                controller.description += ` • ${controller.children.length} 在使用`;
            }

            gpio.addChild(controller);
        });

        if (gpio.children) {
            return gpio;
        }
    }

    private flashOverview(ctx: DTSCtx) {
        const flash = new TreeInfoItem(ctx, '存储', 'flash');
        ctx.nodeArray()
            .filter(n => n.parent && n.type!.is('fixed-partitions'))
            .forEach((n, _, all) => {
                let parent = flash;
                if (all.length > 1) {
                    parent = new TreeInfoItem(ctx, n.parent!.uniqueName);
                    flash.addChild(parent);
                }

                const regs = n.parent!.regs();
                const capacity = regs?.[0]?.sizes[0]?.val;
                if (capacity !== undefined) {
                    parent.description = sizeString(capacity);
                }

                parent.path = n.parent!.path;
                parent.tooltip = n.type?.description;

                let offset = 0;
                n.children().filter(c => c.regs()?.[0]?.addrs.length === 1).sort((a, b) => (a.regs()![0].addrs[0]?.val ?? 0) - (b.regs()![0].addrs[0]?.val ?? 0)).forEach(c => {
                    const reg = c.regs();
                    const start = reg![0].addrs[0].val;
                    const size = reg![0].sizes?.[0]?.val ?? 0;
                    if (start > offset) {
                        const space = new TreeInfoItem(ctx, '未使用空间', undefined, `@ ${addressString(offset)}, ${sizeString(start - offset)}`);
                        parent.addChild(space);
                    }

                    const partition = new TreeInfoItem(ctx, c.property('label')?.value?.[0]?.val as string ?? c.uniqueName);
                    partition.description = `@ ${addressString(start)}, ${sizeString(size)}`;
                    if (start < offset) {
                        partition.description += ` - 有 ${sizeString(offset - start)} 重叠!`;
                    }
                    partition.tooltip = `${addressString(start)} - ${addressString(start + size - 1)}`;
                    partition.path = c.path;

                    partition.addChild(new TreeInfoItem(ctx, '起始:', undefined, addressString(start, 8)));
                    partition.addChild(new TreeInfoItem(ctx, '结束:', undefined, addressString(start + size - 1, 8)));
                    partition.addChild(new TreeInfoItem(ctx, '长度:', undefined, `${size} 字节 (${sizeString(size)})`));

                    parent.addChild(partition);
                    offset = start + size;
                });

                if (capacity !== undefined && offset < capacity) {
                    parent.addChild(new TreeInfoItem(ctx, '未使用空间', undefined, `@ ${addressString(offset)}, ${sizeString(capacity - offset)}`));
                }
            });

        // Some devices don't have partitions defined. For these, show simple flash entries:
        if (!flash.children.length) {
            ctx.nodeArray().filter(n => n.type?.is('soc-nv-flash')).forEach((n, _, all) => {
                let parent = flash;
                if (all.length > 1) {
                    parent = new TreeInfoItem(ctx, n.uniqueName);
                    flash.addChild(parent);
                }

                parent.path = n.path;

                n.regs()?.filter(reg => reg.addrs.length === 1 && reg.sizes.length === 1).forEach((reg, i, areas) => {
                    let area = parent;
                    if (areas.length > 1) {
                        area = new TreeInfoItem(ctx, `分区 ${i + 1}`);
                        parent.addChild(area);
                    }

                    const start = reg.addrs[0].val;
                    const size = reg.sizes[0].val;

                    area.description = `@ ${addressString(start)}, ${sizeString(size)}`;

                    area.addChild(new TreeInfoItem(ctx, '起始:', undefined, addressString(start)));
                    area.addChild(new TreeInfoItem(ctx, '结束:', undefined, addressString(start + size - 1, 8)));
                    area.addChild(new TreeInfoItem(ctx, '长度:', undefined, `${size} 字节 (${sizeString(size)})`));
                });
            });
        }

        if (flash.children.length) {
            return flash;
        }
    }

    private interruptOverview(ctx: DTSCtx) {
        const nodes = ctx.nodeArray();
        const interrupts = new TreeInfoItem(ctx, '中断', 'interrupts');
        const controllers = nodes.filter(n => n.property('interrupt-controller'));
        const controllerItems = controllers.map(n => ({ item: new TreeInfoItem(ctx, n.uniqueName), children: new Array<{ node: Node, interrupts: Property }>() }));
        nodes.filter(n => n.property('interrupts')).forEach(n => {
            const interrupts = n.property('interrupts');
            let node: Node | undefined = n;
            let interruptParent: Property | undefined;
            while (node && !(interruptParent = node.property('interrupt-parent'))) {
                node = node.parent;
            }

            if (!interruptParent?.pHandle) {
                return;
            }

            const ctrlIdx = controllers.findIndex(c => interruptParent?.pHandle?.is(c));
            if (ctrlIdx < 0) {
                return;
            }

            controllerItems[ctrlIdx].children.push({ node: n, interrupts: interrupts! });
        });

        controllerItems.filter(c => c.children.length).forEach((controller, i) => {
            const cells = controllers[i]?.type?.cells('interrupt') as string[];
            controller.children.sort((a, b) => a.interrupts.array![0] - b.interrupts.array![0]).forEach(child => {
                const childIrqs = child.interrupts.arrays;
                const irqNames = child.node.property('interrupt-names')?.stringArray;
                childIrqs?.forEach((cellValues, i, all) => {
                    const irq = new TreeInfoItem(ctx, child.node.uniqueName);
                    irq.path = child.node.path;
                    irq.tooltip = child.node.type?.description;

                    // Some nodes have more than one interrupt:
                    if (all.length > 1) {
                        irq.name += ` (${irqNames?.[i] ?? i})`;
                    }

                    const prio = cellValues[cells?.indexOf('priority')];
                    if (typeof prio === 'number') {
                        irq.description = `优先级: ${prio}`;
                    }

                    cells?.forEach((cell, i) => irq.addChild(new TreeInfoItem(ctx,
                        `${cell}:`, undefined, cellValues?.[i]?.toString() ?? 'N/A')));
                    controller.item.addChild(irq);
                });
            });

            controller.item.path = controllers[i].path;
            controller.item.tooltip = controllers[i].type?.description;
            interrupts.addChild(controller.item);
        });

        // Skip second depth if there's just one interrupt controller
        if (interrupts.children.length === 1) {
            interrupts.children[0].icon = interrupts.icon;
            interrupts.children[0].description = interrupts.children[0].name;
            interrupts.children[0].name = interrupts.name;
            return interrupts.children[0];
        }

        if (interrupts.children.length) {
            return interrupts;
        }
    }

    private busOverview(ctx: DTSCtx) {
        const buses = new TreeInfoItem(ctx, '总线', 'bus');
        ctx.nodeArray().filter(node => node.type?.bus).forEach(node => {
            const bus = new TreeInfoItem(ctx, node.uniqueName, undefined, '');
            if (!bus.name.toLowerCase().includes(node.type!.bus?.toLowerCase())) {
                bus.description = node.type?.bus + ' ';
            }

            bus.path = node.path;
            bus.tooltip = node.type?.description;

            const busProps = [/.*-speed$/, /.*-pin$/, /^clock-frequency$/, /^hw-flow-control$/, /^dma-channels$/];
            node.uniqueProperties().filter(prop => prop.value.length > 0 && busProps.some(regex => prop.name.match(regex))).forEach(prop => {
                const infoItem = new TreeInfoItem(ctx, prop.name.replace(/-/g, ' ') + ':', undefined, prop.value.map(v => v.toString(true)).join(', '));
                infoItem.path = prop.path;
                bus.addChild(infoItem);
            });

            const pinctrls = node.property('pinctrl-names')?.stringArray;
            if (pinctrls) {
                const pinctrlsItem = new TreeInfoItem(ctx, '引脚');
                for (let i = 0; i < pinctrls.length; i++) {
                    const pinctrlNode = node.property(`pinctrl-${i}`);
                    if (pinctrlNode?.pHandles) {
                        const pinctrlItem = new TreeInfoItem(ctx, pinctrls[i]);
                        pinctrlItem.path = pinctrlNode.path;
                        for (const ref of pinctrlNode?.pHandles) {
                            const refItem = new TreeInfoItem(ctx, ref.val);
                            const target = ctx.getPHandleNode(ref.val.substring(1));
                            if (target) {
                                refItem.path = target.path;
                            }
                            pinctrlItem.addChild(refItem);
                        }
                        pinctrlsItem.addChild(pinctrlItem);
                    }
                }
                if (pinctrlsItem.children.length) {
                    bus.addChild(pinctrlsItem);
                }
            }

            const nodesItem = new TreeInfoItem(ctx, '节点');

            node.children().forEach(child => {
                const busEntry = new TreeInfoItem(ctx, child.localUniqueName);
                busEntry.path = child.path;
                busEntry.tooltip = child.type?.description;

                if (child.address !== undefined) {
                    busEntry.description = `@ 0x${child.address.toString(16)}`;

                    // SPI nodes have chip selects
                    if (node.type?.bus === 'spi') {
                        const csGpios = node.property('cs-gpios');
                        const cs = csGpios?.entries?.[child.address];
                        if (cs) {
                            const csEntry = new TreeInfoItem(ctx, `片选`);
                            csEntry.description = `${cs.target.toString(true)} ${cs.cells.map(c => c.toString(true)).join(' ')}`;
                            csEntry.path = csGpios.path;
                            busEntry.addChild(csEntry);
                        }
                    }
                }

                nodesItem.addChild(busEntry);
            });

            if (nodesItem.children.length) {
                bus.description += `• ${nodesItem.children.length} 个节点`;
            }

            bus.addChild(nodesItem);
            buses.addChild(bus);
        });

        if (buses.children.length) {
            return buses;
        }
    }

    private ioChannelOverview(type: 'ADC' | 'DAC', ctx: DTSCtx) {
        const nodes = ctx.nodeArray();
        const adcs = new TreeInfoItem(ctx, type, type.toLowerCase());
        nodes.filter(node => node.type?.is(type.toLowerCase() + '-controller')).forEach(node => {
            const controller = new TreeInfoItem(ctx, node.uniqueName);
            controller.path = node.path;
            controller.tooltip = node.type?.description;
            nodes
                .filter(n => n.property('io-channels')?.entries?.some(entry => (entry.target instanceof PHandle) && entry.target.is(node)))
                .flatMap(usr => {
                    const names = usr.property('io-channel-names')?.stringArray ?? [];
                    return usr.property('io-channels')!.entries!.filter(c => c.target.is(node)).map((channel, i, all) => ({ node: usr, idx: channel.cells[0]?.val ?? -1, name: names[i] ?? ((all.length > 1) && i.toString()) }));
                })
                .sort((a, b) => a.idx - b.idx)
                .forEach(channel => {
                    const entry = new TreeInfoItem(ctx, `通道 ${channel.idx}`, undefined, channel.node.uniqueName + (channel.name ? ` • ${channel.name}` : ''));
                    entry.path = channel.node.path;
                    controller.addChild(entry);
                });

            if (!controller.children.length) {
                controller.addChild(new TreeInfoItem(ctx, '', undefined, '没有在使用的通道'));
            }

            adcs.addChild(controller);
        });

        if (adcs.children.length === 1) {
            adcs.children[0].icon = adcs.icon;
            adcs.children[0].description = adcs.children[0].name;
            adcs.children[0].name = adcs.name;
            return adcs.children[0];
        }

        if (adcs.children.length) {
            return adcs;
        }
    }

    private rootRefsOverview(type: 'chosen' | 'aliases', ctx: DTSCtx) {
        const chosens = new TreeInfoItem(ctx, `/${type}`);
        const entries = ctx.nodes[`/${type}/`]?.entries || [];
        for (const { properties } of entries) {
            for (const { name, pHandle } of properties) {
                if (pHandle && pHandle.kind === 'ref') {
                    const refItem = new TreeInfoItem(ctx, name, undefined, `= ${pHandle.val}`);
                    chosens.addChild(refItem);
                }
            }
        }

        if (chosens.children.length) {
            return chosens;
        }
    }

    private async getOverviewTree(ctx: DTSCtx): Promise<DTSTreeItem[]> {
        const details = new TreeInfoItem(ctx, '概览');
        details.addChild(await this.boardOverview(ctx));
        details.addChild(this.gpioOverview(ctx));
        details.addChild(this.flashOverview(ctx));
        details.addChild(this.interruptOverview(ctx));
        details.addChild(this.busOverview(ctx));
        details.addChild(this.ioChannelOverview('ADC', ctx));
        details.addChild(this.ioChannelOverview('DAC', ctx));

        if (details.children.length) {
            return [details, ...ctx.files];
        }

        return ctx.files;
    }

    getParent(element: DTSTreeItem): vscode.ProviderResult<DTSCtx> {
        if (element instanceof DTSCtx) {
            return;
        }
    }
}
