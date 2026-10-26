// @ts-check
/**
 * Area tile with selected entities: `custom:overview-plus-area-tile`.
 *
 * Looks like the compact area card of the overview page (built from the same Home
 * Assistant tile components: ha-card, ha-tile-container, ha-tile-icon, ha-tile-info,
 * ha-tile-badge), but its value line shows the states of selected entities – also
 * diagnostic sensors and sensors without device class, which the area card cannot show.
 *
 *   type: custom:overview-plus-area-tile
 *   area: proxmox
 *   entities: [sensor.pve_cpu, sensor.pve_memory]   # value line, in this order
 *   show_names: true                                 # "CPU 12 % · RAM 41 %"
 *   alert_classes: [problem]                         # like the area card
 *   alert_entities: [binary_sensor.vm_db_status]     # badge while one of them is on
 *   name, color, tap_action, vertical               # like the area card
 *
 * Layout and behaviour follow home-assistant/frontend
 * src/panels/lovelace/cards/hui-area-card.ts (compact display type).
 */

import { entityAreaId, evaluateIndicators, indicatorColor, INDICATOR_PRESETS, prepareIndicators, watchedIndicators } from "./area-indicators.js";
import { t } from "./i18n.js";

/**
 * @typedef {Object} AreaCache
 * @property {any} entities
 * @property {any} devices
 * @property {any} areas
 * @property {any} config
 * @property {{ indicator: any, config: any, candidates: string[] }[]} prepared
 * @property {{ entities: string[], attributes: string[] }} watch
 * @property {string[]} sensors        sensors of the area (for sensor_classes)
 * @property {string[]} binarySensors  binary sensors of the area (for alert_classes)
 */

export const AREA_TILE_TYPE = "custom:overview-plus-area-tile";
const TAG = "overview-plus-area-tile";
const SEPARATOR = " · ";
/** Most chips in the row; with more active indicators the last chip shows "+N". */
const MAX_CHIPS = 4;
// mdiTextureBox, the default icon of the area card
const AREA_ICON_PATH = "M20 2H4C2.9 2 2 2.9 2 4V20C2 21.11 2.9 22 4 22H20C21.11 22 22 21.11 22 20V4C22 2.9 21.11 2 20 2M4 6L6 4H10.9L4 10.9V6M4 13.7L13.7 4H18.6L4 18.6V13.7M20 18L18 20H13.1L20 13.1V18M20 10.3L10.3 20H5.4L20 5.4V10.3Z";

const STYLE = `
  :host { display: block; height: 100%; --tile-color: var(--state-icon-color); }
  ha-card { height: 100%; display: flex; flex-direction: column; justify-content: space-between;
    transition: box-shadow 180ms ease-in-out, border-color 180ms ease-in-out; }
  ha-card:has(ha-tile-container[focused]) {
    --shadow-default: var(--ha-card-box-shadow, 0 0 0 0 transparent);
    --shadow-focus: 0 0 0 1px var(--tile-color);
    border-color: var(--tile-color);
    box-shadow: var(--shadow-default), var(--shadow-focus);
  }
  ha-tile-icon { --tile-icon-color: var(--tile-color); }
  .alert-badge { --tile-badge-background-color: var(--orange-color); }
  ha-tile-info.twoline { --_tile-info-fixed-primary-line-height: var(--ha-space-4); }
  ha-tile-info.twoline::part(primary) { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
    white-space: normal; overflow-wrap: anywhere; }
  /* Area indicators (area-indicators.js): tinted tile and a row of chips above the room icon */
  ha-card { position: relative; }
  ha-card { --tile-bg: var(--ha-card-background, var(--card-background-color, #fff)); }
  ha-card.tinted {
    --tile-bg: color-mix(in srgb, var(--indicator-color) 16%, var(--ha-card-background, var(--card-background-color, #fff)));
    background: var(--tile-bg);
    border-color: color-mix(in srgb, var(--indicator-color) 45%, transparent);
  }
  /* Space for the chips is kept whenever states are configured, so icons do not jump.
     Only icon and text move: the container draws the hover and ripple background, which
     has to stay aligned with the card. */
  ha-card.has-indicators.vertical ha-tile-container > ha-tile-icon,
  ha-card.has-indicators.vertical ha-tile-container > ha-tile-info { transform: translateY(8px); }
  .chips { position: absolute; top: 7px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; }
  ha-card:not(.vertical) .chips { top: 50%; left: auto; right: 10px; transform: translateY(-50%); }
  .chip { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: #fff; background: var(--chip-color); box-shadow: 0 0 0 2px var(--tile-bg);
    font-size: 11px; font-weight: 600; box-sizing: border-box; cursor: pointer; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .chip ha-icon { --mdc-icon-size: 13px; display: flex; }
  .chip.more { background: var(--secondary-text-color); }
  .fallback { display: flex; flex-direction: column; justify-content: center; gap: 2px; height: 100%; padding: 10px;
    box-sizing: border-box; cursor: pointer; }
  .fallback .primary { font-weight: 500; }
  .fallback .secondary { color: var(--secondary-text-color); font-size: 12px; }
`;

/** @param {any} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** Defines the element; only in a browser (the module is also imported by generators). */
function define() {
  class OverviewPlusAreaTile extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      /** @type {any} */
      this._config = undefined;
      /** @type {any} */
      this._hass = undefined;
      /** @type {string} states of watched entities at the last render */
      this._key = "";
      /** @type {any} */
      this._layout = undefined;
      /** @type {AreaCache | undefined} */
      this._cache = undefined;
      this._waitingForTile = false;
    }

    /** @param {any} v set by Home Assistant ("grid" in sections views) */
    set layout(v) {
      if (v === this._layout) return;
      this._layout = v;
      this._render();
    }

    get layout() {
      return this._layout;
    }

    /** @param {any} config */
    setConfig(config) {
      if (!config?.area) throw new Error("area is required");
      this._config = config;
      this._key = "";
      this._render();
    }

    /** @param {any} hass */
    set hass(hass) {
      this._hass = hass;
      const key = this._watchKey();
      if (key !== this._key) this._render();
    }

    get hass() {
      return this._hass;
    }

    getGridOptions() {
      const rows = this._config?.vertical ? 2 : 1;
      return { columns: 6, rows, min_columns: 3, min_rows: rows };
    }

    getCardSize() {
      return this._config?.vertical ? 2 : 1;
    }

    /** Entities whose state is shown; the tile only re-renders when one of them changes. */
    _watched() {
      if (!this._hass || !this._config) return [];
      const cache = this._cached();
      const classes = list(this._config.alert_classes).length;
      return [
        ...this._entityIds(),
        ...list(this._config.alert_entities),
        ...(classes ? cache.binarySensors : []),
        ...cache.watch.entities,
        ...(this._sensorClasses().length ? cache.sensors : []),
      ];
    }

    _watchKey() {
      const hass = this._hass;
      if (!hass || !this._config) return "";
      const area = hass.areas?.[this._config.area];
      return JSON.stringify([
        area?.name, area?.icon, hass.locale?.language,
        ...this._watched().map((id) => {
          const attrs = hass.states[id]?.attributes;
          return [hass.states[id]?.state, attrs?.unit_of_measurement, attrs?.device_class,
            ...this._cached().watch.attributes.map((name) => attrs?.[name])];
        }),
      ]);
    }

    /** @returns {string[]} */
    _entityIds() {
      return list(this._config?.entities).map((e) => (typeof e === "string" ? e : e?.entity)).filter(Boolean);
    }

    /** Binary sensors that can raise the alert badge: explicit ones, then the area's by class. */
    _alertCandidates() {
      const hass = this._hass;
      const ids = [...list(this._config?.alert_entities)];
      const classes = list(this._config?.alert_classes);
      if (classes.length && hass) {
        ids.push(...this._cached().binarySensors.filter((id) => classes.includes(hass.states?.[id]?.attributes?.device_class)));
      }
      return ids;
    }

    /**
     * Sensor classes shown when no entities are selected, like the area card:
     * `sensor_classes`, by default temperature if the area has a temperature sensor.
     * @returns {string[]}
     */
    _sensorClasses() {
      if (list(this._config.entities).length) return [];
      if (Array.isArray(this._config.sensor_classes)) return this._config.sensor_classes;
      return this._hass?.areas?.[this._config.area]?.temperature_entity_id ? ["temperature"] : [];
    }

    /**
     * Sensors of the area per class: the area's own temperature / humidity sensor,
     * otherwise all numeric sensors of that class (their average is shown).
     * @returns {Record<string, string[]>}
     */
    _classSensors() {
      const hass = this._hass;
      const area = hass.areas?.[this._config.area];
      /** @type {Record<string, string[]>} */
      const result = {};
      for (const cls of this._sensorClasses()) {
        const own = cls === "temperature" ? area?.temperature_entity_id : cls === "humidity" ? area?.humidity_entity_id : undefined;
        result[cls] = own ? [own] : this._cached().sensors.filter((id) => hass.states?.[id]?.attributes?.device_class === cls);
      }
      return result;
    }

    /** @param {string[]} ids */
    _classValue(ids) {
      const hass = this._hass;
      const states = ids.map((id) => hass.states?.[id]).filter((s) => s && !isNaN(Number(s.state)) && s.state !== "");
      if (!states.length) return undefined;
      const format = (/** @type {any} */ stateObj, /** @type {string} */ value) =>
        typeof hass.formatEntityState === "function" ? hass.formatEntityState(stateObj, value) : `${value} ${stateObj.attributes?.unit_of_measurement ?? ""}`.trim();
      if (states.length === 1) return format(states[0], states[0].state);
      const unit = states[0].attributes?.unit_of_measurement;
      const same = states.filter((s) => s.attributes?.unit_of_measurement === unit);
      const avg = same.reduce((sum, s) => sum + Number(s.state), 0) / same.length;
      return format(same[0], String(Math.round(avg * 10) / 10));
    }

    _secondary() {
      const hass = this._hass;
      const classes = this._sensorClasses();
      if (classes.length) {
        const sensors = this._classSensors();
        return classes.map((cls) => this._classValue(sensors[cls] || [])).filter(Boolean).join(SEPARATOR);
      }
      const showNames = !!this._config.show_names;
      return list(this._config.entities)
        .map((e) => {
          const id = typeof e === "string" ? e : e?.entity;
          const stateObj = id ? hass.states?.[id] : undefined;
          if (!stateObj) return undefined;
          const value = typeof hass.formatEntityState === "function" ? hass.formatEntityState(stateObj) : stateObj.state;
          const ownName = typeof e === "object" ? e?.name : undefined;
          if (!showNames && !ownName) return value;
          const name = ownName ?? (typeof hass.formatEntityName === "function" ? hass.formatEntityName(stateObj, { type: "entity" }) : stateObj.attributes?.friendly_name);
          return name ? `${name} ${value}` : value;
        })
        .filter(Boolean)
        .join(SEPARATOR);
    }

    _activeAlert() {
      return this._alertCandidates().map((id) => this._hass.states?.[id]).find((s) => s?.state === "on");
    }

    /** @param {string} action */
    _fireAction(action) {
      this.dispatchEvent(new CustomEvent("hass-action", { detail: { config: this._config, action }, bubbles: true, composed: true }));
    }

    _render() {
      const root = /** @type {ShadowRoot} */ (this.shadowRoot);
      const hass = this._hass;
      if (!this._config || !hass) return;
      this._key = this._watchKey();
      const area = hass.areas?.[this._config.area];
      root.innerHTML = "";
      const style = document.createElement("style");
      style.textContent = STYLE;
      root.appendChild(style);

      const primary = this._config.name || area?.name || this._config.area;
      const secondary = this._secondary();
      const card = document.createElement("ha-card");
      if (this._config.vertical) card.classList.add("vertical");
      const color = indicatorColor(this._config.color);
      if (color) card.style.setProperty("--tile-color", color);
      root.appendChild(card);

      if (!customElements.get("ha-tile-container")) {
        // Render again once Home Assistant has loaded the tile components
        if (!this._waitingForTile) {
          this._waitingForTile = true;
          customElements.whenDefined("ha-tile-container").then(() => {
            this._waitingForTile = false;
            this._render();
          });
        }
        // Plain fallback if the tile components are not loaded (they normally are)
        const box = document.createElement("div");
        box.className = "fallback";
        box.innerHTML = '<div class="primary"></div><div class="secondary"></div>';
        /** @type {HTMLElement} */ (box.querySelector(".primary")).textContent = primary;
        /** @type {HTMLElement} */ (box.querySelector(".secondary")).textContent = secondary;
        box.addEventListener("click", () => this._fireAction("tap"));
        card.appendChild(box);
        this._renderIndicators(card);
        return;
      }

      const fixedInfoHeight = this._layout === "grid" && this._config.grid_options?.rows !== "auto";
      const container = /** @type {any} */ (document.createElement("ha-tile-container"));
      container.featurePosition = "bottom";
      container.vertical = !!this._config.vertical;
      container.fixedInfoHeight = fixedInfoHeight;
      container.interactive = !!this._config.tap_action && this._config.tap_action.action !== "none";
      container.addEventListener("action", (/** @type {any} */ ev) => this._fireAction(ev.detail?.action || "tap"));

      const icon = /** @type {any} */ (document.createElement("ha-tile-icon"));
      icon.slot = "icon";
      if (area?.icon) icon.icon = area.icon;
      else icon.iconPath = AREA_ICON_PATH;
      const alert = this._activeAlert();
      if (alert) {
        const badge = document.createElement("ha-tile-badge");
        badge.className = "alert-badge";
        const stateIcon = /** @type {any} */ (document.createElement("ha-state-icon"));
        stateIcon.hass = hass;
        stateIcon.stateObj = alert;
        badge.appendChild(stateIcon);
        icon.appendChild(badge);
      }

      const info = /** @type {any} */ (document.createElement("ha-tile-info"));
      info.slot = "info";
      if (this._config.vertical && fixedInfoHeight) info.className = "twoline";
      info.primary = primary;
      info.secondary = secondary || undefined;

      container.append(icon, info);
      card.appendChild(container);
      this._renderIndicators(card);
    }

    /**
     * What the tile needs from the registries: prepared area states and the area's
     * sensors / binary sensors. Cached until the registries or the config change; device
     * classes are read from the states when evaluating, as states may arrive later.
     * @returns {AreaCache}
     */
    _cached() {
      const hass = this._hass;
      const cache = this._cache;
      if (cache && cache.entities === hass.entities && cache.devices === hass.devices && cache.areas === hass.areas && cache.config === this._config) {
        return cache;
      }
      /** @type {string[]} */
      const sensors = [];
      /** @type {string[]} */
      const binarySensors = [];
      const wantSensors = !list(this._config.entities).length;
      const wantBinary = list(this._config.alert_classes).length > 0;
      if (wantSensors || wantBinary) {
        for (const [id, entry] of Object.entries(hass.entities || {})) {
          const sensor = id.startsWith("sensor.");
          if (!(sensor && wantSensors) && !(id.startsWith("binary_sensor.") && wantBinary)) continue;
          if (entry?.hidden || entry?.entity_category || entityAreaId(hass, id) !== this._config.area) continue;
          (sensor ? sensors : binarySensors).push(id);
        }
      }
      let prepared = [];
      try {
        prepared = prepareIndicators(hass, this._config.area, this._config.indicators);
      } catch (err) {
        console.error("[overview-plus] area states could not be prepared – shown without them.", err);
      }
      this._cache = {
        entities: hass.entities, devices: hass.devices, areas: hass.areas, config: this._config,
        prepared, watch: watchedIndicators(prepared), sensors, binarySensors,
      };
      return this._cache;
    }

    /**
     * Area states: the first active "tile" indicator tints the tile, "icon" indicators
     * are chips in a row above the room icon (at most MAX_CHIPS, then "+N").
     * @param {HTMLElement} card
     */
    _renderIndicators(card) {
      const prepared = this._cached().prepared;
      if (!prepared.length) return;
      card.classList.add("has-indicators");
      let active;
      try {
        active = evaluateIndicators(this._hass, prepared);
      } catch (err) {
        console.error("[overview-plus] area states could not be evaluated.", err);
        return;
      }
      if (!active.length) return;
      const hass = this._hass;
      const name = (/** @type {any} */ i) =>
        i.name || (i.key in INDICATOR_PRESETS ? t(hass, `indicator_${i.key}`) : hass.states?.[i.entities[0]]?.attributes?.friendly_name || i.key);
      const tile = active.find((i) => i.style === "tile");
      if (tile) {
        const color = indicatorColor(tile.color) || "var(--primary-color)";
        card.style.setProperty("--indicator-color", color);
        card.style.setProperty("--tile-color", color);
        card.classList.add("tinted");
      }
      // For screen readers: all active states, also the one shown as tint
      const label = document.createElement("span");
      label.className = "sr-only";
      label.textContent = active.map(name).join(", ");
      card.appendChild(label);

      const icons = active.filter((i) => i.style === "icon");
      if (!icons.length) return;
      const shown = icons.length > MAX_CHIPS ? icons.slice(0, MAX_CHIPS - 1) : icons;
      const row = document.createElement("div");
      row.className = "chips";
      row.setAttribute("aria-hidden", "true");
      // Chips show their name on hover; a click acts like a click on the tile
      row.addEventListener("click", () => this._fireAction("tap"));
      for (const indicator of shown) {
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.style.setProperty("--chip-color", indicatorColor(indicator.color) || "var(--primary-color)");
        chip.title = name(indicator);
        const icon = /** @type {any} */ (document.createElement("ha-icon"));
        icon.icon = indicator.icon;
        chip.appendChild(icon);
        row.appendChild(chip);
      }
      if (icons.length > shown.length) {
        const more = document.createElement("div");
        more.className = "chip more";
        more.textContent = `+${icons.length - shown.length}`;
        more.title = icons.slice(shown.length).map(name).join(", ");
        row.appendChild(more);
      }
      card.appendChild(row);
    }
  }

  customElements.define(TAG, OverviewPlusAreaTile);
}

if (typeof HTMLElement !== "undefined" && globalThis.customElements && !customElements.get(TAG)) define();
