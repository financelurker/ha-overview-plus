// @ts-check
/**
 * Dialog shell of the popups (popup.js) and the device list (device-list.js): a native
 * <dialog> styled with Home Assistant's theme variables, with a title, header buttons
 * and a close button. It closes on Escape, on a click on the backdrop and when the
 * page changes (also the back button on phones).
 */

const TAG = "overview-plus-popup";

// mdiClose
const CLOSE_PATH = "M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z";

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

/** @param {Event} ev whether the event comes from inside one of our dialogs */
export const insideDialog = (ev) => ev.composedPath().some((el) => /** @type {any} */ (el)?.localName === TAG);

/**
 * @typedef {Object} DialogButton
 * @property {string} path      mdi icon path
 * @property {string} label
 * @property {() => void} onClick
 * @property {string} [className]
 */

/**
 * Open a dialog. `content` is filled by the caller; `onClose` runs once when it closes.
 * @param {{ title: string, closeLabel: string, buttons?: DialogButton[], style?: string, onClose?: () => void }} options
 * @returns {{ content: HTMLElement, dismiss: () => void }}
 */
export function openDialog({ title, closeLabel, buttons = [], style = "", onClose }) {
  const host = document.createElement(TAG);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLE}${style}</style><dialog><header><span class="title"></span></header><div class="content"></div></dialog>`;
  const dialog = /** @type {HTMLDialogElement} */ (root.querySelector("dialog"));
  const header = /** @type {HTMLElement} */ (root.querySelector("header"));
  /** @type {HTMLElement} */ (root.querySelector(".title")).textContent = title;
  const content = /** @type {HTMLElement} */ (root.querySelector(".content"));

  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener("location-changed", dismiss);
    window.removeEventListener("popstate", dismiss);
    if (dialog.open) dialog.close();
    host.remove();
    onClose?.();
  };

  /** @param {string} path @param {string} label @param {() => void} onClick @param {string} [className] */
  const addButton = (path, label, onClick, className = "") => {
    const button = document.createElement("button");
    button.className = className;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg viewBox="0 0 24 24"><path d="${path}"/></svg>`;
    button.addEventListener("click", onClick);
    header.append(button);
  };
  for (const b of buttons) addButton(b.path, b.label, b.onClick, b.className);
  addButton(CLOSE_PATH, closeLabel, dismiss, "close");

  // Navigating away (also the back button on phones) closes the dialog
  window.addEventListener("location-changed", dismiss);
  window.addEventListener("popstate", dismiss);
  dialog.addEventListener("close", dismiss); // Escape key
  dialog.addEventListener("click", (ev) => {
    if (ev.target === dialog) dismiss(); // click on the backdrop
  });
  document.body.appendChild(host);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  return { content, dismiss };
}
