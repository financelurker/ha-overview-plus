// Fake `hass` object with a small home: a living room and a virtual "proxmox" area.

/** @param {string} id @param {string} state @param {Record<string, any>} [attributes] */
const st = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });

/** @param {string} id @param {Record<string, any>} [extra] */
const ent = (id, extra = {}) => ({ entity_id: id, platform: "demo", labels: [], ...extra });

export function makeHass(overrides = {}) {
  const states = Object.fromEntries(
    [
      st("light.ceiling", "on", { supported_color_modes: ["brightness"] }),
      st("light.lamp", "off", { supported_color_modes: ["onoff"] }),
      st("climate.living", "heat", { supported_features: 1 }),
      st("sensor.living_temp", "21", { device_class: "temperature" }),
      st("sensor.living_hum", "45", { device_class: "humidity" }),
      st("sensor.trv_battery", "80", { device_class: "battery" }),
      st("sensor.trv_signal", "-60", { device_class: "signal_strength" }),
      st("media_player.tv", "off"),
      st("scene.movie", "unknown"),
      st("automation.evening", "on"),
      st("switch.plug", "on"),
      st("sensor.hidden", "1"),
      // proxmox
      st("sensor.pve_cpu", "12", { unit_of_measurement: "%" }),
      st("binary_sensor.pve_status", "on", { device_class: "running" }),
      st("sensor.pve_uptime", "100", { device_class: "duration" }),
      st("binary_sensor.vm_web_status", "on", { device_class: "running" }),
      st("sensor.vm_web_cpu", "3"),
      st("button.vm_web_reboot", "unknown"),
      st("binary_sensor.vm_db_status", "off", { device_class: "running" }),
      st("sensor.vm_db_cpu", "0"),
      st("sensor.exporter_load", "0.5"),
      st("sensor.ups_load", "30"),
    ].map((s) => [s.entity_id, s])
  );

  const entities = Object.fromEntries(
    [
      ent("light.ceiling", { device_id: "dev_light" }),
      ent("light.lamp", { area_id: "living_room" }),
      ent("climate.living", { device_id: "dev_trv", platform: "better_thermostat" }),
      ent("sensor.living_temp", { device_id: "dev_trv" }),
      ent("sensor.living_hum", { area_id: "living_room" }),
      ent("sensor.trv_battery", { device_id: "dev_trv", entity_category: "diagnostic" }),
      ent("sensor.trv_signal", { device_id: "dev_trv", entity_category: "diagnostic" }),
      ent("media_player.tv", { device_id: "dev_tv" }),
      ent("scene.movie", { area_id: "living_room" }),
      ent("automation.evening", { area_id: "living_room", platform: "automation" }),
      ent("switch.plug", { device_id: "dev_plug" }),
      ent("sensor.hidden", { device_id: "dev_plug", hidden: true }),
      ent("sensor.pve_cpu", { device_id: "dev_pve", platform: "proxmoxve" }),
      ent("binary_sensor.pve_status", { device_id: "dev_pve", platform: "proxmoxve" }),
      ent("sensor.pve_uptime", { device_id: "dev_pve", platform: "proxmoxve", entity_category: "diagnostic" }),
      ent("binary_sensor.vm_web_status", { device_id: "dev_vm_web", platform: "proxmoxve" }),
      ent("sensor.vm_web_cpu", { device_id: "dev_vm_web", platform: "proxmoxve" }),
      ent("button.vm_web_reboot", { device_id: "dev_vm_web", platform: "proxmoxve", entity_category: "config" }),
      ent("binary_sensor.vm_db_status", { device_id: "dev_vm_db", platform: "proxmoxve" }),
      ent("sensor.vm_db_cpu", { device_id: "dev_vm_db", platform: "proxmoxve" }),
      ent("sensor.exporter_load", { device_id: "dev_exporter", platform: "mqtt" }),
      ent("sensor.ups_load", { device_id: "dev_ups", platform: "mqtt" }),
    ].map((e) => [e.entity_id, e])
  );

  const dev = (id, area_id, extra = {}) => [id, { id, area_id, labels: [], name: id, ...extra }];
  const devices = Object.fromEntries([
    dev("dev_light", "living_room", { name: "Ceiling light" }),
    dev("dev_trv", "living_room", { name: "Radiator" }),
    dev("dev_tv", "living_room", { name: "TV" }),
    dev("dev_plug", "living_room", { name: "Plug", name_by_user: "Coffee machine" }),
    dev("dev_pve", "proxmox", { name: "pve1", manufacturer: "Proxmox", labels: ["virt-hypervisor"] }),
    dev("dev_vm_web", null, { name: "web", parent_device_id: "dev_pve", labels: ["virt-guest"] }),
    dev("dev_vm_db", null, { name: "db", parent_device_id: "dev_pve", labels: ["virt-guest"] }),
    dev("dev_exporter", "proxmox", { name: "pve exporter", manufacturer: "Proxmox VE Exporter" }),
    dev("dev_ups", "proxmox", { name: "UPS", manufacturer: "APC" }),
  ]);

  return {
    states,
    entities,
    devices,
    areas: {
      living_room: {
        area_id: "living_room", name: "Living room", floor_id: "ground",
        temperature_entity_id: "sensor.living_temp", humidity_entity_id: "sensor.living_hum",
      },
      proxmox: { area_id: "proxmox", name: "Proxmox", floor_id: "virtual", icon: "mdi:server" },
      empty: { area_id: "empty", name: "Empty" },
    },
    floors: { ground: { floor_id: "ground" }, virtual: { floor_id: "virtual" } },
    labels: {},
    panels: { light: {}, climate: {}, security: {} },
    user: { is_admin: true },
    locale: { language: "en" },
    localize: () => "",
    ...overrides,
  };
}

/** Headings of all sections, in order. */
export const headings = (view) => view.sections.map((s) => s.cards[0]?.heading);

/** All cards of all sections (without headings). */
export const cards = (view) => view.sections.flatMap((s) => s.cards.filter((c) => c.type !== "heading"));
