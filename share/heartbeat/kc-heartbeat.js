// KC-Lebenszeichen - eine Datei, eine Zeile Einbau.
//
//   <script type="module">
//     import { startHeartbeat } from './kc-heartbeat.js';
//     startHeartbeat({ programId: 'kc-bilderkasse', name: 'KC Bilderkasse',
//                      version: '1.4.2', endpoint: '…/functions/v1/kicc-program-heartbeat',
//                      token: '<oeffentlicher Schluessel>' });
//   </script>
//
// Was das Lebenszeichen belegt: dass dieses Programm zu diesem Zeitpunkt
// benutzt wurde. Was es NICHT belegt: dass ein Dienst laeuft. Es kommt aus dem
// Browser - ist niemand da, kommt nichts. Das ist kein Ausfall, und der KC
// System Check bewertet es auch nicht als solchen, solange die Anwendung nicht
// ausdruecklich scharfgestellt ist.
//
// Der Schluessel ist der oeffentliche Gateway-Schluessel, derselbe, der auch
// sonst im Browser liegt. Er erlaubt nichts ausser dem Melden. Ein
// Dienstschluessel gehoert hier NICHT hinein.

const SCHEMA = "kicc.program-heartbeat.v1";
const REMOTE_SCHEMA = "kicc.remote-program-heartbeat.v1";

function instanceId(programId) {
  const key = `${programId}.instance.id.v1`;
  try {
    let id = localStorage.getItem(key);
    if (!id) { id = `browser-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`; localStorage.setItem(key, id); }
    return id;
  } catch { return "browser"; }
}

/**
 * @param {object} o
 * @param {string} o.programId  Kennung, unter der das Programm gefuehrt wird
 * @param {string} o.name       Klartextname
 * @param {string} o.version    Version des Programms
 * @param {string} o.endpoint   Adresse der Lebenszeichen-Funktion
 * @param {string} o.token      oeffentlicher Schluessel
 * @param {number} [o.everySeconds=60]  Sendetakt
 * @param {() => {errorCount?:number,queueDepth?:number}} [o.metrics]
 *        Optional: eigene Kennzahlen. errorCount > 0 faerbt die Kachel im
 *        System Check - melde hier nur, was wirklich eine Stoerung ist.
 */
export function startHeartbeat(o) {
  const { programId, name, version, endpoint, token, everySeconds = 60, metrics } = o || {};
  if (!programId || !endpoint || !token) {
    console.warn("[kc-heartbeat] programId, endpoint und token sind Pflicht - Lebenszeichen bleibt aus");
    return { send: async () => false, state: () => ({ error: "unvollstaendig" }) };
  }
  const id = instanceId(programId);
  let lastOkAt = null, lastError = null, fehlerFolge = 0, gemeldeterGrund = null;

  const build = () => {
    let m = {};
    try { m = metrics?.() || {}; } catch { /* eigene Kennzahlen duerfen nie das Melden verhindern */ }
    const versteckt = typeof document !== "undefined" && document.visibilityState === "hidden";
    return {
      schema: SCHEMA, programId, instanceId: id, deviceId: `program:${programId}:${id}`,
      name: name || programId, deviceType: "PROGRAM", version: version || null, build: version || null,
      status: versteckt ? "DEGRADED" : "ONLINE",
      measuredAt: new Date().toISOString(),
      latencyMs: null, trafficRx: null, trafficTx: null,
      queueDepth: Number(m.queueDepth || 0), errorCount: Number(m.errorCount || 0),
      source: "KC_PROGRAM_SELF_HEARTBEAT", trust: "SELF_REPORTED",
      message: versteckt ? `${name || programId} im Hintergrund` : `${name || programId} aktiv`,
    };
  };

  const send = async () => {
    const envelope = {
      schema: REMOTE_SCHEMA,
      nonce: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      sentAt: new Date().toISOString(),
      authState: "AUTHENTICATED", sourceId: id, heartbeat: build(),
    };
    try {
      const r = await fetch(endpoint, {
        method: "POST", cache: "no-store", credentials: "omit",
        headers: { "content-type": "application/json", accept: "application/json",
                   authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`, apikey: token },
        body: JSON.stringify(envelope),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      lastOkAt = new Date().toISOString(); lastError = null;
      fehlerFolge = 0; gemeldeterGrund = null;
      return true;
    } catch (e) {
      // Ein ausgefallenes Lebenszeichen darf das Programm nie stoeren.
      lastError = e instanceof Error ? e.message : String(e);
      fehlerFolge += 1;
      // Aber es darf auch nicht spurlos verschwinden: wer nicht melden kann,
      // kann das Nichtmelden erst recht nicht melden. Auf der Empfaengerseite
      // sieht ein blockierter Meldeweg genauso aus wie ein Programm, das
      // niemand benutzt. Die einzige Stelle, an der der Grund ueberhaupt
      // bekannt ist, ist hier - also steht er hier auch in der Konsole.
      // Einmal je Grund, nicht bei jedem Versuch.
      if (lastError !== gemeldeterGrund) {
        gemeldeterGrund = lastError;
        console.warn(`[kc-heartbeat] Lebenszeichen nicht zugestellt (${fehlerFolge}. Versuch): ${lastError} · fuer die Ueberwachung sieht das aus wie "Programm nicht benutzt"`);
      }
      return false;
    }
  };

  setTimeout(send, 5000);
  setInterval(send, Math.max(30, everySeconds) * 1000);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (!document.hidden) send(); });

  return { send, state: () => ({ instanceId: id, lastOkAt, lastError, failedInARow: fehlerFolge }) };
}
