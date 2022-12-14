/*
 * Copyright (c) 2020 Trond Snekvik
 *
 * SPDX-License-Identifier: MIT
 */
import * as vscode from 'vscode';
import { basename } from 'path';
import { DTSCtx, DTSFile, IntValue, Node, Parser, PHandle, Property } from './dts/dts';
import { addressString, sizeString } from './dts/util';
import { resolveBoardInfo } from './zephyr';
import icon from './utils/icon';
import { getPinctrls, parsePinctrl, PinMux } from './pinctrl';
import { sortBy } from 'lodash';

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
                item.tooltip = '??????????????????';
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
                    item.tooltip = '????????????';
                    item.contextValue = 'devicetree.board';
                } else {
                    if (element.ctx.overlays.indexOf(element) === element.ctx.overlays.length - 1) {
                        item.iconPath = icon('overlay');
                        item.contextValue = 'devicetree.overlay';
                    } else {
                        item.iconPath = icon('shield');
                        item.contextValue = 'devicetree.shield';
                    }
                    item.tooltip = '??????';
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
        const board = new TreeInfoItem(ctx, '??????', 'circuit-board');

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
            name: '??????:',
            arch: '??????:',
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
        const pins: {
            port: string;
            pin: number;
            node: Node;
            prop?: Property;
        }[] = [];

        for (const node of ctx.nodeArray()) {
            for (const prop of node.properties()) {
                const port = prop.pHandleArray?.[0].val[0];
                const pin = prop.pHandleArray?.[0].val[1];
                if (!(port instanceof PHandle) || !(pin instanceof IntValue)) {
                    continue;
                }
                const isGpio = ctx.node(port.val)?.property('gpio-controller')?.boolean;
                if (!isGpio) {
                    continue;
                }
                pins.push({ port: port.val, pin: pin.val, node, prop });
            }
        }

        const pinmuxes: Record<string, { pinmux: PinMux; node: Node; refs: Property[] }> = {};
        for (const node of ctx.nodeArray()) {
            if (!node.refName) {
                continue;
            }
            const pinmux = parsePinctrl(node);
            if (!pinmux) {
                continue;
            }
            pinmuxes[node.refName] = { pinmux, node, refs: [] };
        }
        for (const bus of ctx.nodeArray().filter(node => node.type?.bus)) {
            for (const { prop, refs } of getPinctrls(bus) || []) {
                for (const ref of refs) {
                    if (pinmuxes[ref.val]) {
                        pinmuxes[ref.val].refs.push(prop);
                    }
                }
            }
        }
        for (const { pinmux, node, refs } of Object.values(pinmuxes)) {
            if (refs.length > 0) {
                for (const ref of refs) {
                    pins.push({ port: pinmux.port, pin: pinmux.pin, node, prop: ref });
                }
            } else {
                pins.push({ port: pinmux.port, pin: pinmux.pin, node, prop: undefined });
            }
        }

        const gpio = new TreeInfoItem(ctx, '??????', 'gpio');
        for (const { port, pin, node, prop } of sortBy(pins, 'port', 'pin')) {
            const pinItem = new TreeInfoItem(ctx, `${port} ${pin}`);
            pinItem.description = node.labels().length > 0 ? node.refName : node.path;
            pinItem.path = node.path;
            if (prop) {
                const name = prop.node.labels().length > 0 ? prop.node.refName : basename(node.path);
                const nodeItem = new TreeInfoItem(ctx, name);
                nodeItem.description = prop.name;
                nodeItem.path = prop.path;
                pinItem.addChild(nodeItem);
            }
            gpio.addChild(pinItem);
        }

        if (gpio.children.length > 0) {
            return gpio;
        }
    }

    private flashOverview(ctx: DTSCtx) {
        const flash = new TreeInfoItem(ctx, '??????', 'flash');
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
                        const space = new TreeInfoItem(ctx, '???????????????', undefined, `@ ${addressString(offset)}, ${sizeString(start - offset)}`);
                        parent.addChild(space);
                    }

                    const partition = new TreeInfoItem(ctx, c.property('label')?.value?.[0]?.val as string ?? c.uniqueName);
                    partition.description = `@ ${addressString(start)}, ${sizeString(size)}`;
                    if (start < offset) {
                        partition.description += ` - ??? ${sizeString(offset - start)} ??????!`;
                    }
                    partition.tooltip = `${addressString(start)} - ${addressString(start + size - 1)}`;
                    partition.path = c.path;

                    partition.addChild(new TreeInfoItem(ctx, '??????:', undefined, addressString(start, 8)));
                    partition.addChild(new TreeInfoItem(ctx, '??????:', undefined, addressString(start + size - 1, 8)));
                    partition.addChild(new TreeInfoItem(ctx, '??????:', undefined, `${size} ?????? (${sizeString(size)})`));

                    parent.addChild(partition);
                    offset = start + size;
                });

                if (capacity !== undefined && offset < capacity) {
                    parent.addChild(new TreeInfoItem(ctx, '???????????????', undefined, `@ ${addressString(offset)}, ${sizeString(capacity - offset)}`));
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
                        area = new TreeInfoItem(ctx, `?????? ${i + 1}`);
                        parent.addChild(area);
                    }

                    const start = reg.addrs[0].val;
                    const size = reg.sizes[0].val;

                    area.description = `@ ${addressString(start)}, ${sizeString(size)}`;

                    area.addChild(new TreeInfoItem(ctx, '??????:', undefined, addressString(start)));
                    area.addChild(new TreeInfoItem(ctx, '??????:', undefined, addressString(start + size - 1, 8)));
                    area.addChild(new TreeInfoItem(ctx, '??????:', undefined, `${size} ?????? (${sizeString(size)})`));
                });
            });
        }

        if (flash.children.length) {
            return flash;
        }
    }

    private interruptOverview(ctx: DTSCtx) {
        const nodes = ctx.nodeArray();
        const interrupts = new TreeInfoItem(ctx, '??????', 'interrupts');
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
                        irq.description = `?????????: ${prio}`;
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
        const buses = new TreeInfoItem(ctx, '??????', 'bus');
        for (const node of ctx.nodeArray().filter(node => node.type?.bus)) {
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

            const pinctrls = getPinctrls(node);
            if (pinctrls) {
                const pinctrlsItem = new TreeInfoItem(ctx, '??????');
                for (const pinctrl of pinctrls) {
                    const pinctrlItem = new TreeInfoItem(ctx, pinctrl.name);
                    pinctrlItem.path = pinctrl.prop.path;
                    for (const ref of pinctrl.refs) {
                        const refItem = new TreeInfoItem(ctx, ref.val);
                        const target = ctx.node(ref.val);
                        if (target) {
                            refItem.path = target.path;
                            const pinmux = parsePinctrl(target);
                            if (pinmux) {
                                refItem.description = `= <${pinmux.port} ${pinmux.pin} ${pinmux.func}>`;
                            }
                        }
                        pinctrlItem.addChild(refItem);
                    }
                    pinctrlsItem.addChild(pinctrlItem);
                }
                if (pinctrlsItem.children.length) {
                    bus.addChild(pinctrlsItem);
                }
            }

            const nodesItem = new TreeInfoItem(ctx, '??????');

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
                            const csEntry = new TreeInfoItem(ctx, `??????`);
                            csEntry.description = `${cs.target.toString(true)} ${cs.cells.map(c => c.toString(true)).join(' ')}`;
                            csEntry.path = csGpios.path;
                            busEntry.addChild(csEntry);
                        }
                    }
                }

                nodesItem.addChild(busEntry);
            });

            if (nodesItem.children.length) {
                bus.description += `??? ${nodesItem.children.length} ?????????`;
            }

            bus.addChild(nodesItem);
            buses.addChild(bus);
        }

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
                    const entry = new TreeInfoItem(ctx, `?????? ${channel.idx}`, undefined, channel.node.uniqueName + (channel.name ? ` ??? ${channel.name}` : ''));
                    entry.path = channel.node.path;
                    controller.addChild(entry);
                });

            if (!controller.children.length) {
                controller.addChild(new TreeInfoItem(ctx, '', undefined, '????????????????????????'));
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
        const refs = new TreeInfoItem(ctx, `/${type}`);
        const entries = ctx.node(`/${type}/`)?.entries || [];
        for (const { properties } of entries) {
            for (const { name, pHandle, path } of properties) {
                if (pHandle && pHandle.kind === 'ref') {
                    const refItem = new TreeInfoItem(ctx, name, undefined, `= ${pHandle.val}`);
                    refItem.path = path;

                    const targetItem = new TreeInfoItem(ctx, pHandle.val);
                    targetItem.path = ctx.node(pHandle.val)?.path;

                    refItem.addChild(targetItem);
                    refs.addChild(refItem);
                }
            }
        }

        if (refs.children.length) {
            return refs;
        }
    }

    private async getOverviewTree(ctx: DTSCtx): Promise<DTSTreeItem[]> {
        const details = new TreeInfoItem(ctx, '??????');
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
