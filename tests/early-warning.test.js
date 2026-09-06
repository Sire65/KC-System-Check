// Faehrt die echte Abtastung der Fruehwarnung, statt den Quelltext zu lesen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const quelle=readFileSync("js/early-warning.js","utf8");
const teil=quelle.slice(0,quelle.indexOf("function warnings("));
const speicher=new Map();
globalThis.localStorage={getItem:k=>speicher.has(k)?speicher.get(k):null,setItem:(k,v)=>speicher.set(k,String(v))};
let karten=[];
globalThis.document={querySelector:()=>null,querySelectorAll:()=>karten};
const bau=new Function(`${teil}; return {sample,trend,load};`)();

const karte=(titel,text,aus=false)=>({dataset:aus?{kcTrend:"off"}:{},textContent:`${titel} ${text}`,querySelector:()=>({textContent:titel})});

test("eine Messumstellung ist kein Trend", () => {
  karten=[karte("Antwortdaten","8 ms")];
  for(let i=0;i<4;i++){bau.sample();karten[0].textContent=`Antwortdaten ${8+i} ms`}
  karten=[karte("Antwortdaten","1100 ms")];   // Umstellung: hundertfacher Sprung
  const db=bau.sample();
  const reihe=db["antwortdaten"];
  assert.equal(reihe.length,1,"die alte Reihe wird verworfen, nicht weitergerechnet");
  assert.equal(bau.trend(reihe),null,"aus einem einzelnen Wert entsteht keine Warnung");
});

test("Zaehlerkacheln werden gar nicht erst beobachtet", () => {
  speicher.clear();
  karten=[karte("Edge-Function-Aufrufe","464 ms",true)];
  const db=bau.sample();
  assert.equal(Object.keys(db).length,0,"data-kc-trend=off haelt kumulative Zaehler heraus");
});

test("ein echter Anstieg wird weiterhin gemeldet", () => {
  speicher.clear();
  karten=[karte("KC Core","100 ms")];
  for(const v of [100,120,150,190]){karten[0].textContent=`KC Core ${v} ms`;bau.sample()}
  const t=bau.trend(bau.load()["kc core"]);
  assert.ok(t,"ein echter Trend darf nicht verschwinden");
  assert.match(t.text,/steigend \+90 %/);
});

test("der Sammler liest die Kacheln, nicht die umschliessende Tafel", () => {
  // Anlass: '#usage .card' traf die Tafel. Gelesen wurde die erste Zahl mit
  // Einheit irgendwo darin, beschriftet mit der Ueberschrift der ersten
  // Kachel - Zahl und Bezeichnung gehoerten nicht zusammen.
  assert.match(quelle, /#capacity \.capacity-card,#usage \.usage-card/);
  assert.doesNotMatch(quelle.split("\n").filter(z=>!z.trimStart().startsWith("//")).join("\n"), /#usage \.card/);
});

test("kumulative Zaehler sind in der Oberflaeche als solche gekennzeichnet", () => {
  const a = readFileSync("js/app.js", "utf8");
  for (const titel of ["Edge-Function-Aufrufe", "Interne Provider-Requests", "Automatik / manuell", "Antwortdaten"]) {
    const i = a.indexOf(`<strong>${titel}</strong>`);
    assert.ok(i > 0, `${titel} nicht gefunden`);
    assert.match(a.slice(Math.max(0, i - 220), i), /data-kc-trend="off"/,
      `${titel} zaehlt ueber 31 Tage hoch - Steigen ist dort keine Auffaelligkeit`);
  }
});
