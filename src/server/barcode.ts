// The "./node" entry: the package root has no condition TypeScript's bundler resolution matches.
import bwipjs from "bwip-js/node";
import { isEncodableSku } from "@/lib/labels";

/**
 * A SKU as a bars-only Code 128 SVG for labels, sized by CSS (preserveAspectRatio="none"), and
 * its width in modules for the label-fit check. Null when the SKU can't be encoded.
 */
export function renderSkuBarcode(sku: string): { svg: string; modules: number } | null {
  if (!isEncodableSku(sku)) return null;
  // At scale 1 with no padding, bwip-js draws one SVG unit per module, so the viewBox width is
  // the module count.
  const svg = bwipjs.toSVG({ bcid: "code128", text: sku, scale: 1, height: 10, includetext: false });
  const width = /viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1];
  if (!width) return null;
  return { svg: svg.replace("<svg ", '<svg preserveAspectRatio="none" '), modules: Number(width) };
}
