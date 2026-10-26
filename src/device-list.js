// @ts-check
/**
 * Device list: the heading of a configured area section that shows entities of several
 * devices opens a dialog listing those devices; a click on one opens its device page.
 *
 * The area view gives the heading the tap action
 *   { action: "fire-dom-event", overview_plus_devices: { title, devices: [{ id, name }] } }
 * Home Assistant fires such an action as `ll-custom` event with the action as detail;
 * a capture listener on `window` opens the dialog. The dialog follows
 * Home Assistant's theme (dialog.js).
 */

import { openDialog } from "./dialog.js";
import { t } from "./i18n.js";

export const DEVICE_LIST_KEY = "overview_plus_devices";

// mdiChevronRight
const CHEVRON_PATH = "M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z";

const STYLE = `
  ul { list-style: none; margin: 0; padding: 0; }
  li button { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: flex; align-items: center; gap: 12px;
    padding: 12px 8px 12px 16px; border-radius: var(--ha-border-radius-md, 12px); }
  li button:hover, li button:focus-visible { background: var(--secondary-background-color, rgba(0,0,0,.06)); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-size: 16px; line-height: 24px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .secondary { font-size: 14px; line-height: 20px; color: var(--secondary-text-color);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li svg { width: 24px; height: 24px; flex: none; fill: var(--secondary-text-color); }
`;

/** @param {string} path */
function goTo(path) {
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

/**
 * Open the list of devices.
 * @param {any} hass
 * @param {{ title?: string, devices?: { id: string, name?: string }[] }} list
 */
export function openDeviceList(hass, list) {
  const devices = Array.isArray(list?.devices) ? list.devices.filter((d) => d && typeof d.id === "string") : [];
  if (!devices.length) return false;
  const { content, dismiss } = openDialog({ title: list.title || t(hass, "devices"), closeLabel: t(hass, "popup_close"), style: STYLE });
  const ul = document.createElement("ul");
  for (const { id, name } of devices) {
    const device = hass?.devices?.[id];
    const button = document.createElement("button");
    const text = document.createElement("span");
    text.className = "text";
    const primary = document.createElement("span");
    primary.className = "name";
    primary.textContent = name || device?.name_by_user || device?.name || id;
    text.append(primary);
    // Manufacturer and model tell apart devices with similar names
    const secondary = [device?.manufacturer, device?.model].filter(Boolean).join(" · ");
    if (secondary) {
      const line = document.createElement("span");
      line.className = "secondary";
      line.textContent = secondary;
      text.append(line);
    }
    button.append(text);
    button.insertAdjacentHTML("beforeend", `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${CHEVRON_PATH}"/></svg>`);
    button.addEventListener("click", () => {
      dismiss();
      goTo(`/config/devices/device/${id}`);
    });
    const li = document.createElement("li");
    li.append(button);
    ul.append(li);
  }
  content.append(ul);
  // Start on the first device rather than on the close button
  /** @type {HTMLElement | null} */ (ul.querySelector("button"))?.focus();
  return true;
}

/** @param {Event} ev */
function onCustomAction(ev) {
  const list = /** @type {any} */ (ev).detail?.[DEVICE_LIST_KEY];
  if (!list) return;
  ev.stopPropagation();
  try {
    openDeviceList(/** @type {any} */ (document.querySelector("home-assistant"))?.hass, list);
  } catch (err) {
    console.error("[overview-plus] device list could not be opened.", err);
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined" && !(/** @type {any} */ (window).__overviewPlusDeviceList)) {
  /** @type {any} */ (window).__overviewPlusDeviceList = true;
  window.addEventListener("ll-custom", onCustomAction, true);
}
