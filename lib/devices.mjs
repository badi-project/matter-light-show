// Toutes les lampes, quel que soit leur système : Matter (pont Hue, IKEA, Aqara, Smart Life compatibles Matter…)
// et les pilotes directs (WiZ en Wi-Fi, Home Assistant, Zigbee2MQTT).
// Les identifiants Matter restent « nœud-endpoint » (ex. « 1-2 ») ; les autres sont préfixés (« wiz:… », « ha:… », « z2m:… »).
import { EventEmitter } from "node:events";

export const SOURCE_LABEL = { matter: "Matter", wiz: "WiZ", ha: "Home Assistant", z2m: "Zigbee" };

export class DeviceHub extends EventEmitter {
    drivers = new Map();

    constructor(matter) {
        super();
        this.matter = matter;
        matter.on("changed", () => this.emit("changed"));
    }

    addDriver(driver) {
        this.removeDriver(driver.id);
        this.drivers.set(driver.id, driver);
        driver.on("changed", () => this.emit("changed"));
        this.emit("changed");
    }

    removeDriver(id) {
        const d = this.drivers.get(id);
        if (!d) return;
        this.drivers.delete(id);
        d.removeAllListeners("changed");
        try {
            d.stop();
        } catch {}
        this.emit("changed");
    }

    #driverFor(id) {
        const p = String(id).indexOf(":");
        return p > 0 ? this.drivers.get(String(id).slice(0, p)) : null;
    }

    getLamps() {
        const matter = this.matter.getLamps().map(l => ({ ...l, source: "matter", bus: `matter:${l.nodeId}` }));
        return [...matter, ...[...this.drivers.values()].flatMap(d => d.getLamps())];
    }

    hasLamp(id) {
        const d = this.#driverFor(id);
        return d ? d.hasLamp(id) : this.matter.hasLamp(id);
    }

    /** Pour le répartiteur : nom (messages d'erreur) et passerelle (débit). */
    getLampForDispatch(id) {
        const d = this.#driverFor(id);
        if (d) return d.getLamp(id);
        const l = this.matter.getLampForDispatch(id);
        return l ? { name: l.name, bus: `matter:${l.nodeId}` } : null;
    }

    exec(id, cmd) {
        const d = this.#driverFor(id);
        return d ? d.exec(id, cmd) : this.matter.exec(id, cmd);
    }

    statuses() {
        return [...this.drivers.values()].map(d => d.status());
    }
}
