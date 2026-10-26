// @ts-check
/** Small helpers shared by the view generators. */

/** @param {any} v @returns {boolean} a plain object (not an array) */
export const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** @param {any} v @returns {any[]} one value or a list as a list; nothing as empty list */
export const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]);

/** A state as written in YAML: YAML 1.1 reads an unquoted off / on as false / true. @param {any} v */
export const stateText = (v) => (v === true ? "on" : v === false ? "off" : String(v));

/** @param {string} path */
export const navigateAction = (path) => ({ action: "navigate", navigation_path: path });

/** Registries whose change regenerates the views. */
const REGISTRY_DEPS = ["entities", "devices", "areas", "floors", "labels", "panels"];

/** @param {any} oldHass @param {any} newHass */
export const registryChanged = (oldHass, newHass) => REGISTRY_DEPS.some((k) => oldHass[k] !== newHass[k]);
