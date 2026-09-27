# KC SpeicherCheck

Android-App zum Prüfen des gemeinsamen Gerätespeichers.

## Funktionen
- Scan des gemeinsamen internen Speichers nach ausdrücklicher Android-Freigabe.
- Ampelbewertung:
  - GRÜN: typische temporäre oder generierte Entwicklungsartefakte.
  - GELB: Archive, APKs, Backups und byte-identische Dubletten, die geprüft werden sollten.
  - ROT: sehr große unbekannte Dateien; keine pauschale Lösch-Empfehlung.
- Sortierung nach Speicherverbrauch und Mehrfachauswahl.
- Zweite Sicherheitsabfrage vor jeder dauerhaften Löschung.\n- **Sicher automatisch bereinigen**: löscht ohne Einzelauswahl nur streng freigegebene Treffer direkt im Download-Ordner (alte Archive und byte-identische Dubletten).\n- Automatik-Schutz: WhatsApp, DCIM/Kamera, Pictures/Bilder, Documents, Entwicklung, Orbit, Projekt-Unterordner sowie APK/AAB-Dateien werden nicht automatisch gelöscht.
- Ausschluss von \`/Android/data\` und \`/Android/obb\`.
- Scanbericht als TXT unter \`Dokumente/KC_SpeicherCheck/\`.
- Update-Prüfung über GitHub: manuell per Button und höchstens einmal täglich beim App-Start.
- APK-Updates werden nur nach Freigabe geladen und vor der Installation per SHA-256 geprüft.

## Datenschutz / Sicherheit
Der Speicher-Scan bleibt vollständig lokal. Internetzugriff wird ausschließlich für die Update-Prüfung und den von dir freigegebenen Update-Download verwendet. Die automatische Bereinigung läuft ausschließlich nach einem bewussten Knopfdruck und einer zusammengefassten Sicherheitsabfrage; außerhalb der eng definierten Download-Regeln wird nichts automatisch gelöscht.

## Update-Kanal
Die App liest:
\`https://raw.githubusercontent.com/Sire65/KC-System-Check/main/android/kc-speichercheck/update.json\`

Für eine neue Version müssen dort \`versionCode\`, \`versionName\`, \`apkUrl\` und die SHA-256-Prüfsumme der APK aktualisiert werden.

**Wichtig:** Jede installierbare Folgeversion muss mit demselben Android-Signierschlüssel wie die erste installierte Release-APK signiert werden. Den privaten Signierschlüssel niemals in GitHub einchecken.

## Installation/Build
Projekt in Android Studio öffnen und APK bauen. Min SDK 26, Target/Compile SDK 35.

Aktuelle Quellversion: **1.1.0** (\`versionCode 2\`).
