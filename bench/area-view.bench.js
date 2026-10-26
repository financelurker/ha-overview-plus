// Benchmark: area view generation for a large installation.
// Run: node bench/area-view.bench.js
import { generateAreaView } from "../src/views/area-view.js";

function bigHass({ areas = 40, devicesPerArea = 15, entitiesPerDevice = 7, unassigned = 600 } = {}) {
  const states = {}, entities = {}, devices = {}, areaReg = {};
  const domains = ["light", "sensor", "binary_sensor", "switch", "climate", "cover", "media_player", "button", "select", "number"];
  const classes = { sensor: ["temperature", "humidity", "battery", "power", undefined], binary_sensor: ["window", "door", "motion", "running"], cover: ["blind", "door"] };
  for (let a = 0; a < areas; a++) {
    const areaId = `area_${a}`;
    areaReg[areaId] = { area_id: areaId, name: `Room ${a}`, floor_id: "f", aliases: [] };
    for (let d = 0; d < devicesPerArea; d++) {
      const devId = `dev_${a}_${d}`;
      devices[devId] = { id: devId, area_id: areaId, name: `Room ${a} Device ${d}`, labels: d % 5 === 0 ? ["virt-guest"] : [], manufacturer: d % 2 ? "Proxmox" : "Shelly" };
      for (let e = 0; e < entitiesPerDevice; e++) {
        const domain = domains[(d + e) % domains.length];
        const id = `${domain}.d${a}_${d}_${e}`;
        const dc = classes[domain]?.[e % classes[domain].length];
        states[id] = { entity_id: id, state: "on", attributes: { device_class: dc, supported_features: 1, supported_color_modes: ["brightness"] } };
        entities[id] = { entity_id: id, device_id: devId, platform: d % 3 ? "mqtt" : "zha", labels: [], name: `E${e}`, entity_category: e === 6 ? "diagnostic" : undefined };
      }
    }
  }
  for (let i = 0; i < unassigned; i++) {
    const id = `sensor.free_${i}`;
    states[id] = { entity_id: id, state: "1", attributes: {} };
    entities[id] = { entity_id: id, platform: "template", labels: [] };
  }
  return { states, entities, devices, areas: areaReg, floors: { f: { floor_id: "f" } }, labels: {}, panels: {}, user: { is_admin: true },
    locale: { language: "de" }, localize: () => "",
    formatEntityName: (s) => { const e = entities[s.entity_id]; const dv = e?.device_id ? devices[e.device_id] : undefined; return [dv?.name, e?.name].filter(Boolean).join(" "); } };
}

const RULES = [
  { match: { integration: "zha", domain: "climate" }, card: { type: "custom:bt" } },
  { match: { manufacturer: "^Proxmox$", domain: "sensor" }, card: { color: "green" } },
  { match: { device_name: ["Device 1$", "Device 2$"] }, card: { name: "x" } },
];
const OVERRIDE = { sections: [
  { title: "VMs", match: { label: "virt-guest" }, layout: "compact" },
  { title: "Proxmox", match: { manufacturer: "Proxmox" }, layout: "devices" },
] };

function time(label, fn, runs = 30) {
  fn(); // warm-up
  const t = [];
  for (let i = 0; i < runs; i++) { const s = performance.now(); fn(); t.push(performance.now() - s); }
  t.sort((a, b) => a - b);
  console.log(`${label.padEnd(44)} median ${t[runs >> 1].toFixed(2)} ms   max ${t.at(-1).toFixed(2)} ms`);
}

const hass = bigHass();
console.log(`${Object.keys(hass.states).length} entities, ${Object.keys(hass.devices).length} devices, ${Object.keys(hass.areas).length} areas`);
time("default area view", () => generateAreaView(hass, "area_3"));
time("default area view + card rules", () => generateAreaView(hass, "area_3", { card_rules: RULES }));
time("override area view + card rules", () => generateAreaView(hass, "area_3", { card_rules: RULES, override: OVERRIDE }));
time("all 40 area views (dashboard switch)", () => { for (let a = 0; a < 40; a++) generateAreaView(hass, `area_${a}`, { card_rules: RULES }); }, 5);
