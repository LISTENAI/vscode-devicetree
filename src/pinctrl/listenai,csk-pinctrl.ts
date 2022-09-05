import { PinctrlParser, PinMux } from '.';
import { IntValue, Node, PHandle } from '../dts/dts';

export default <PinctrlParser>{
  parse(node: Node): PinMux | undefined {
    const pinctrls = node.property('pinctrls')?.pHandleArray?.[0]?.val;
    if (!pinctrls) {
      return;
    }

    const pinmux = (pinctrls[0] as PHandle).val;
    const pin = (pinctrls[1] as IntValue).val;
    const func = (pinctrls[2] as IntValue).val;

    const match = pinmux.match(/^&pinmux(.+)$/);
    if (!match) {
      return;
    }

    return { port: `&gpio${match[1]}`, pin, func };
  }
};
