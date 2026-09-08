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

const karte=(titel,text,aus=false,zusatz={})=>({dataset:{...(aus?{kcTrend:"off"}:{}),...zusatz},textContent:`${titel} ${text}`,querySelector:s=>s==="strong"?{textContent:titel}:null});
const reihe=(werte,unit="ms")=>werte.map((v,i)=>({t:Date.now()+i*60_000,v,u:unit}));

test("eine Messumstellung ist kein Trend", () => {
  karten=[karte("Antwortdaten","8 ms")];
  for(let i=0;i<4;i++){bau.sample();karten[0].textContent=`Antwortdaten ${8+i} ms`}
  karten=[karte("Antwortdaten","1100 ms")];   // Umstellung: hundertfacher Sprung
  const db=bau.sample();
  const r=db["antwortdaten"];
  assert.equal(r.length,1,"die alte Reihe wird verworfen, nicht weitergerechnet");
  assert.equal(bau.trend(r),null,"aus einem einzelnen Wert entsteht keine Warnung");
});

test("Zaehlerkacheln werden gar nicht erst beobachtet", () => {
  speicher.clear();
  karten=[karte("Edge-Function-Aufrufe","464 ms",true)];
  const db=bau.sample();
  assert.equal(Object.keys(db).length,0,"data-kc-trend=off haelt kumulative Zaehler heraus");
});

test("niedrige Antwortzeiten erzeugen trotz grosser Prozentzahl keine Warnung", () => {
  // Reale Fehlwarnung 08.09.2026: Future Academy wurde bei ca. 364 ms als
  // +194 % steigend markiert, obwohl der Serverzustand gesund war.
  const t=bau.trend(reihe([124,180,260,364]));
  assert.equal(t,null,"unter 600 ms ist die Prozentzahl allein nicht relevant");
});

test("ein einzelner Antwortzeit-Spike ist noch kein Trend", () => {
  const t=bau.trend(reihe([180,190,200,1000]));
  assert.equal(t,null,"ein einzelner hoher Wert muss erst bestaetigt werden");
});

test("ein nachhaltiger Antwortzeit-Anstieg wird weiterhin sichtbar", () => {
  const t=bau.trend(reihe([420,620,780,1050]));
  assert.ok(t,"ein echter, anhaltender Anstieg darf nicht verschwinden");
  assert.equal(t.level,"warn");
  assert.match(t.text,/Antwortzeit 1050 ms/);
  assert.match(t.text,/nachhaltig steigend/);
});

test("kleine Prozent-Auslastung bleibt trotz relativer Steigerung ruhig", () => {
  const t=bau.trend(reihe([1,1.1,1.2,1.3],"%"));
  assert.equal(t,null,"1 auf 1.3 Prozent ist kein Kapazitaetsproblem");
});

test("hohe und steigende Auslastung wird weiterhin gemeldet", () => {
  const t=bau.trend(reihe([60,64,68,72],"%"));
  assert.ok(t);
  assert.equal(t.level,"warn");
  assert.match(t.text,/steigend \+20 %/);
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

// Aus dem Bericht vom 2026-09-06: die Kapazitaetsreihen standen konstant auf
// 500mb / 512mb - das ist die Freigrenze aus "210.4 / 500 MB", nicht die
// Belegung. Eine Konstante kann keinen Trend zeigen, es wurde also nichts
// beobachtet. Jetzt zeichnet die Kachel den Belegungsanteil aus.
test("die ausgezeichnete Zahl geht vor dem Text", () => {
  speicher.clear();
  karten=[karte("KC Core · Supabase","210.4 / 500 MB",false,{kcMetric:"42.1",kcUnit:"%"})];
  const db=bau.sample();
  const r=db["kc core · supabase"];
  assert.equal(r[0].v,42.1,"die Belegung, nicht die Grenze");
  assert.equal(r[0].u,"%");
});

// "metric-1" ist als Warnung wertlos und haengt am Platz im Baum.
test("ohne erkennbaren Namen wird nicht beobachtet", () => {
  speicher.clear();
  karten=[{dataset:{},textContent:"irgendwas 120 ms",querySelector:()=>null}];
  assert.equal(Object.keys(bau.sample()).length,0);
});

test("eine Ueberschrift reicht als Name", () => {
  speicher.clear();
  karten=[{dataset:{},textContent:"KC Core 120 ms",querySelector:s=>s==="h3"?{textContent:"KC Core"}:null}];
  assert.deepEqual(Object.keys(bau.sample()),["kc core"]);
});
