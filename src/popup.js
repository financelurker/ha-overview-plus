// @ts-check
/**
 * Popups: a card rule can open a card of its own instead of Home Assistant's
 * more-info dialog.
 *
 *   card_rules:
 *     - match: { domain: climate }
 *       tap:
 *         popup: { type: thermostat }      # any card; $entity = the tapped entity
 *
 * The card factory stores the popup on the generated card config under
 * `overview_plus.popup`. Cards open more-info by firing the `hass-more-info` event
 * (the default tap action of most cards, and the menu of cards without tap action).
 * A capture listener on `window` sees the event before Home Assistant does: if it
 * comes from a card with a popup, the event is stopped and the popup opens instead.
 * Cards that hand their actions to Home Assistant (`hass-action`) are remembered for
 * a moment, because the more-info event then comes from Home Assistant's root element.
 * Cards of other dashboards are not affected, because they carry no popup.
 *
 * The popup is a native <dialog> styled with Home Assistant's theme variables; the
 * card inside is created with the public `loadCardHelpers()` and follows `hass`
 * of the `home-assistant` element while it is open.
 */

import { POPUP_KEY, substitute } from "./card-factory.js";
import { t } from "./i18n.js";

const TAG = "overview-plus-popup";

// mdiClose, mdiInformationOutline
const CLOSE_PATH = "M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z";
const INFO_PATH = "M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z";

const STYLE = `
  dialog {
    border: none; padding: 0; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 64px);
    border-radius: var(--ha-dialog-border-radius, 24px);
    background: var(--ha-dialog-surface-background, var(--card-background-color, #fff));
    color: var(--primary-text-color); box-shadow: var(--ha-dialog-box-shadow, 0 8px 32px rgba(0,0,0,.3));
    overflow: hidden; display: flex; flex-direction: column;
  }
  dialog:not([open]) { display: none; }
  dialog::backdrop { background: var(--ha-dialog-scrim-color, rgba(0, 0, 0, 0.32)); }
  header { display: flex; align-items: center; gap: 4px; padding: 12px 12px 4px 24px; }
  header .title { flex: 1; font-size: 22px; line-height: 28px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header button { all: unset; cursor: pointer; width: 40px; height: 40px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center; color: var(--secondary-text-color); }
  header button:hover, header button:focus-visible { background: var(--secondary-background-color, rgba(0,0,0,.06)); }
  header svg { width: 24px; height: 24px; fill: currentColor; }
  .content { padding: 8px 24px 24px; overflow: auto; }
  @media (max-width: 600px) {
    dialog { width: 100vw; max-width: 100vw; height: 100%; max-height: 100%; border-radius: 0; }
  }
`;

/** @param {any} v */
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** @param {any} value @returns {boolean} */
const usesEntity = (value) =>
  typeof value === "string"
    ? /\$entity\b/.test(value)
    : Array.isArray(value)
      ? value.some(usesEntity)
      : isObject(value) && Object.values(value).some(usesEntity);

/**
 * Card config of the popup for a tapped entity: `$entity` is replaced, and `entity`
 * is set unless the card uses the placeholder.
 * @param {Record<string, any>} popup
 * @param {string | undefined} entityId
 */
export function popupCardConfig(popup, entityId) {
  const placeholder = usesEntity(popup);
  const card = substitute(popup, { entity: entityId });
  if (!placeholder && card.entity === undefined && entityId) card.entity = entityId;
  return card;
}

/**
 * Popup stored on a card config (directly, or on the card wrapped by the lazy card).
 * @param {any} config
 * @returns {Record<string, any> | undefined}
 */
function popupOf(config) {
  const own = config?.[POPUP_KEY]?.popup ?? config?.card?.[POPUP_KEY]?.popup;
  return isObject(own) && typeof own.type === "string" ? own : undefined;
}

/**
 * Popup for a hass-more-info event: from the innermost card on the event path that has one.
 * @param {Event} ev
 */
export function popupForEvent(ev) {
  for (const el of /** @type {any[]} */ (ev.composedPath())) {
    if (!el || el === window || el === document) break;
    const popup = popupOf(el.config) ?? popupOf(el._config);
    if (popup) return popup;
  }
  return undefined;
}

/** Events fired by the popup itself to open the regular more-info dialog. */
let passThrough = false;

function homeAssistant() {
  return /** @type {any} */ (document.querySelector("home-assistant"));
}

/**
 * @param {Record<string, any>} popup
 * @param {string | undefined} entityId
 */
async function openPopup(popup, entityId) {
  const ha = homeAssistant();
  let hass = ha?.hass;
  if (!hass) return false;
  const config = popupCardConfig(popup, entityId);
  let card;
  try {
    const helpers = await /** @type {any} */ (window).loadCardHelpers();
    card = helpers.createCardElement(config);
  } catch (err) {
    console.error("[overview-plus] popup card could not be created – showing more-info.", err);
    return false;
  }
  card.hass = hass;

  const host = document.createElement(TAG);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLE}</style><dialog><header><span class="title"></span>` +
    `<button class="info"><svg viewBox="0 0 24 24"><path d="${INFO_PATH}"/></svg></button>` +
    `<button class="close"><svg viewBox="0 0 24 24"><path d="${CLOSE_PATH}"/></svg></button></header>` +
    `<div class="content"></div></dialog>`;
  const dialog = /** @type {HTMLDialogElement} */ (root.querySelector("dialog"));
  const stateObj = entityId ? hass.states?.[entityId] : undefined;
  /** @type {HTMLElement} */ (root.querySelector(".title")).textContent = stateObj?.attributes?.friendly_name ?? "";
  const info = /** @type {HTMLButtonElement} */ (root.querySelector(".info"));
  const close = /** @type {HTMLButtonElement} */ (root.querySelector(".close"));
  info.title = t(hass, "popup_more_info");
  info.setAttribute("aria-label", info.title);
  close.title = t(hass, "popup_close");
  close.setAttribute("aria-label", close.title);
  if (!entityId) info.hidden = true;
  /** @type {HTMLElement} */ (root.querySelector(".content")).appendChild(card);

  // Follow state changes while open: home-assistant gets a new hass object on every change
  let frame = 0;
  const follow = () => {
    if (!host.isConnected) return;
    const next = homeAssistant()?.hass;
    if (next && next !== hass) {
      hass = next;
      card.hass = next;
    }
    frame = requestAnimationFrame(follow);
  };
  frame = requestAnimationFrame(follow);

  const dismiss = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("location-changed", dismiss);
    window.removeEventListener("popstate", dismiss);
    if (dialog.open) dialog.close();
    host.remove();
  };
  // Navigating away (also the back button on phones) closes the popup
  window.addEventListener("location-changed", dismiss);
  window.addEventListener("popstate", dismiss);
  dialog.addEventListener("close", dismiss); // Escape key
  dialog.addEventListener("click", (ev) => {
    if (ev.target === dialog) dismiss(); // click on the backdrop
  });
  close.addEventListener("click", dismiss);
  info.addEventListener("click", () => {
    dismiss();
    passThrough = true;
    try {
      homeAssistant()?.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
    } finally {
      passThrough = false;
    }
  });
  document.body.appendChild(host);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  return true;
}

/** @param {Event} ev */
const insidePopup = (ev) => ev.composedPath().some((el) => /** @type {any} */ (el)?.localName === TAG);

/**
 * Popup of the card that last fired `hass-action`. Many cards hand their actions to
 * Home Assistant this way, and Home Assistant then fires `hass-more-info` from its
 * root element – without the card on the event path.
 * @type {{ popup: Record<string, any>, until: number } | undefined}
 */
let pending;

/** @param {Event} ev */
function onAction(ev) {
  if (insidePopup(ev)) return;
  const popup = popupOf(/** @type {any} */ (ev).detail?.config) ?? popupForEvent(ev);
  pending = popup ? { popup, until: Date.now() + 1000 } : undefined;
}

/** @param {Event} ev */
function onMoreInfo(ev) {
  if (passThrough) return;
  const detail = /** @type {any} */ (ev).detail;
  // Events from inside an open popup go to the regular more-info dialog
  if (insidePopup(ev)) return;
  const recent = pending && pending.until >= Date.now() ? pending.popup : undefined;
  pending = undefined;
  const popup = popupForEvent(ev) ?? recent;
  if (!popup) return;
  ev.stopPropagation();
  ev.preventDefault();
  openPopup(popup, detail?.entityId).then((opened) => {
    if (opened) return;
    passThrough = true;
    try {
      homeAssistant()?.dispatchEvent(new CustomEvent("hass-more-info", { detail, bubbles: true, composed: true }));
    } finally {
      passThrough = false;
    }
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined" && !(/** @type {any} */ (window).__overviewPlusPopup)) {
  /** @type {any} */ (window).__overviewPlusPopup = true;
  window.addEventListener("hass-action", onAction, true);
  window.addEventListener("hass-more-info", onMoreInfo, true);
}
