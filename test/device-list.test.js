// The list of devices opened by the heading of an area section with several devices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { makeHass } from "./fixtures.js";

const win = new Window({ url: "http://ha.local/lovelace/0" });
for (const key of ["window", "document", "customElements", "HTMLElement", "CustomEvent", "Event", "history", "location"]) {
  globalThis[key] = win[key];
}
const { DEVICE_LIST_KEY } = await import("../src/device-list.js");

const ha = document.createElement("home-assistant");
/** @type {any} */ (ha).hass = makeHass();
document.body.appendChild(ha);

const dialogs = () => [...document.querySelectorAll("overview-plus-popup")];
const fire = (detail) => {
  const heading = document.createElement("div");
  document.body.appendChild(heading);
  heading.dispatchEvent(new CustomEvent("ll-custom", { detail, bubbles: true, composed: true }));
  heading.remove();
};

test("the heading's action opens the list; a device opens its device page", () => {
  const changes = [];
  window.addEventListener("location-changed", () => changes.push(location.pathname));
  fire({ action: "fire-dom-event", [DEVICE_LIST_KEY]: { title: "Multimedia", devices: [{ id: "dev_tv", name: "TV" }, { id: "dev_pve", name: "pve1" }] } });
  assert.equal(dialogs().length, 1);
  const root = dialogs()[0].shadowRoot;
  assert.equal(root.querySelector(".title").textContent, "Multimedia");
  const rows = [...root.querySelectorAll("li button")];
  assert.deepEqual(rows.map((b) => b.querySelector(".name").textContent), ["TV", "pve1"]);
  assert.equal(rows[1].querySelector(".secondary").textContent, "Proxmox", "manufacturer / model as second line");
  rows[1].dispatchEvent(new Event("click"));
  assert.equal(location.pathname, "/config/devices/device/dev_pve");
  assert.deepEqual(changes, ["/config/devices/device/dev_pve"]);
  assert.equal(dialogs().length, 0, "the list closes");
});

test("the close button closes the list; other custom actions are ignored", () => {
  fire({ action: "fire-dom-event", [DEVICE_LIST_KEY]: { title: "X", devices: [{ id: "dev_tv" }] } });
  const root = dialogs()[0].shadowRoot;
  assert.equal(root.querySelector("li .name").textContent, "TV", "name from the registry if not given");
  root.querySelector("button.close").dispatchEvent(new Event("click"));
  assert.equal(dialogs().length, 0);
  fire({ action: "fire-dom-event", browser_mod: { service: "x" } });
  fire({ action: "fire-dom-event", [DEVICE_LIST_KEY]: { devices: [] } });
  assert.equal(dialogs().length, 0);
});
