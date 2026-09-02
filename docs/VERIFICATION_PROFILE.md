# KC System Check – Verification Profile

Stand: 02.09.2026

## Bedeutung der 100-%-Anzeige

**100 % bedeutet: 100 % der definierten und aktuell messbaren Prüfungen wurden erfolgreich bewertet.**

Die Anzeige ist **keine absolute Fehlerfreiheitsgarantie**. Unbekannte Fehler, nicht modellierte Geschäftslogikfehler, noch nicht integrierte Systeme und Sicherheitsklassen ohne aktive Prüfmethode können dadurch nicht ausgeschlossen werden.

## Prüfdomänen

1. Erreichbarkeit und reale Latenz der aktiv angebundenen Systeme
2. Datenbank-Kapazität und Free-Tier-Schutz
3. Spiegelung Supabase → Neon: Alter, Status und Abweichungszahl
4. GitHub-/Deployment-Erreichbarkeit
5. LIVE-Heartbeat und Aktualität angeschlossener Programme
6. PWA-/Service-Worker-Version und Cache-Konsistenz
7. Startmodul-/JavaScript-Syntax und vollständiges Pages-Bundle
8. Browser-End-to-End-Smoke-Tests auf mobiler Viewport-Größe
9. Öffentliche Runtime-Konfiguration ohne offensichtliche privilegierte Geheimnisse
10. Statische Qualitätsprüfungen mit unabhängigen Fremdwerkzeugen

## Sicherheitsorientierung

Die Sicherheitsprüfung orientiert sich an **OWASP ASVS 5.0** und dem OWASP Web Security Testing Guide. Das ist eine Prüforientierung, keine Behauptung einer vollständigen ASVS-Zertifizierung.

## TÜV-/Regression-Regel

Ein Release gilt nur dann als freigabefähig, wenn:

- mindestens 50 automatisierte Regressionstests erfolgreich sind,
- sämtliche Startmodule syntaktisch geprüft wurden,
- das GitHub-Pages-Paket alle importierten Laufzeitmodule enthält,
- Versionsdatei, Updater, Heartbeat und Service-Worker-Cache übereinstimmen,
- ESLint und esbuild als unabhängige statische Fremdwerkzeuge erfolgreich laufen,
- Playwright einen echten Browser-Smoke-Test des mobilen Frontends erfolgreich ausführt,
- keine automatische Reparatur produktiver Daten durch den System Check erfolgt.

## Grundregel

Grün bedeutet: **Für die aktuell definierten und messbaren Prüfbereiche liegt kein erkannter Handlungsbedarf vor.**
Gelb bedeutet: prüfen/beobachten. Rot bedeutet: handeln.
