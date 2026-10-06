// Mises à jour en direct des pages ouvertes (Server-Sent Events) et journal du logiciel.
const MAX_BUFFER = 256 * 1024; // un téléphone en veille garde sa connexion à moitié ouverte : on ne remplit pas sa file sans fin

export class LiveEvents {
    clients = new Set();
    logs = [];
    /** Vrai quand une page est ouverte (sinon inutile de préparer ce qu'on lui enverrait). */
    get watched() {
        return this.clients.size > 0;
    }
    get phones() {
        let n = 0;
        for (const c of this.clients) if (c.remote) n++;
        return n;
    }
    /** Pages ouvertes sur le Mac lui-même (l'app « Show lumière » s'en sert pour ne pas rouvrir d'onglet). */
    get pages() {
        return this.clients.size - this.phones;
    }

    broadcast(event, data) {
        if (!this.clients.size) return;
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const res of this.clients) this.#write(res, payload);
    }

    #write(res, payload) {
        if (res.writableEnded || res.destroyed) return this.clients.delete(res);
        if (res.writableLength > MAX_BUFFER) {
            this.clients.delete(res);
            return res.destroy();
        }
        res.write(payload);
    }

    log(level, msg) {
        const entry = { t: Date.now(), level, msg };
        this.logs.push(entry);
        if (this.logs.length > 150) this.logs.shift();
        console.log(`${new Date().toLocaleTimeString("fr-FR")}  ${level.toUpperCase().padEnd(7)} ${msg}`);
        this.broadcast("log", entry);
    }

    /** Ouvre le flux d'une page : état complet tout de suite, puis les changements. */
    attach(req, res, { remote, first, onChange }) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(`event: state\ndata: ${JSON.stringify(first)}\n\n`);
        res.remote = remote;
        this.clients.add(res);
        if (remote) onChange?.();
        const ping = setInterval(() => this.#write(res, ": ping\n\n"), 20000);
        req.on("close", () => {
            clearInterval(ping);
            this.clients.delete(res);
            if (remote) onChange?.();
        });
    }

    /** Ferme les flux des téléphones (accès coupé). */
    closePhones() {
        for (const c of [...this.clients]) {
            if (!c.remote) continue;
            this.clients.delete(c);
            c.end();
        }
    }
}
