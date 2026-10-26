// A happy-dom window as the global browser environment of a test file.
import { Window } from "happy-dom";

const BASE_KEYS = ["window", "document", "customElements", "HTMLElement", "CustomEvent", "Event"];

/**
 * @param {{ url?: string, keys?: string[], stubs?: string[] }} [options]
 *   keys: further globals (e.g. "history"); stubs: custom elements defined as plain elements
 *   that keep their properties (stand-ins for Home Assistant's components)
 */
export function installDom({ url = "http://ha.local/", keys = [], stubs = [] } = {}) {
  const win = new Window({ url });
  for (const key of [...BASE_KEYS, ...keys]) globalThis[key] = win[key];
  for (const tag of stubs) win.customElements.define(tag, class extends win.HTMLElement {});
  return win;
}
