# KC SpeicherCheck

Android-App zum Prüfen des gemeinsamen Gerätespeichers.

## Funktionen
- Scan des gemeinsamen internen Speichers nach ausdrücklicher Android-Freigabe.
- Ampelbewertung:
  - GRÜN: typische temporäre oder generierte Entwicklungsartefakte.
  - GELB: Archive, APKs, Backups und byte-identische Dubletten, die geprüft werden sollten.
  - ROT: sehr große unbekannte Dateien; keine pauschale Lösch-Empfehlung.
- Sortierung nach Speicherverbrauch und Mehrfachauswahl.
- Doppeltipp auf einen Treffer öffnet bei Fotos eine Bildvorschau, bei Videos eine interne Wiedergabe und sonst die Dateidetails.
- Byte-identische Dubletten werden in Gruppen geführt; die Referenzkopie, die erhalten bleibt, wird angezeigt.
- Projektstände derselben Versionsgruppe werden dateiweise per SHA-256 gegen den bevorzugten Referenzstand geprüft. Nur vollständig enthaltene, byte-identische Altstände werden GRÜN und für die automatische Bereinigung freigegeben; fehlende oder abweichende Dateien bleiben geschützt.
- Zweite Sicherheitsabfrage vor jeder dauerhaften Löschung.
- Kleine alte Archive direkt im Download-Ordner werden ab 14 Tagen unabhängig von ihrer Dateigröße erfasst und können automatisch bereinigt werden.
- **Sicher automatisch bereinigen**: löscht ohne Einzelauswahl nur streng freigegebene Treffer. Dazu gehören sichere Altstände/Archive sowie leere Ordner bzw. reine Leerordner-Bäume außerhalb geschützter Android-, System-, App- und Medienbereiche.
- **Hauptverzeichnis-Diagnose**: bewertet jeden direkt unter „Interner Speicher“ sichtbaren Ordner als geschützt, belegt, wirklich leer/löschbar oder nicht lesbar. Die Diagnose wird im Bericht mit direkter Elementzahl und Pfad ausgegeben.
- **Zusatzspeicher-Tiefenscan**: weitere Android-Speicherprofile wie `/storage/emulated/999` werden jetzt zusätzlich direkt unter `/storage/emulated` erkannt und – soweit lesbar – rekursiv geprüft. Die Lupe durchsucht diese Profile ebenfalls. Automatische Löschungen bleiben dort standardmäßig gesperrt.
- **ZIP-Inhaltsprüfung**: ZIP-Dateien werden geöffnet und auf Gültigkeit, Einträge, enthaltene Dateien und unkomprimierte Größe geprüft; leere oder beschädigte ZIPs bleiben von der Automatik ausgeschlossen.
- **Kompakte Oberfläche**: Statistik-/Erklärungsblock ist standardmäßig eingeklappt und wird über die Kurzzeile `Details ▼/▲` ein- bzw. ausgeblendet; keine zusätzliche Bedienzeile.
- **Ordner-Explorer**: neuer kompakter Explorer-Button in der bestehenden dritten Buttonzeile. Ordner und Unterordner können gezielt ausgewählt und separat gescannt werden; der Scan-Bereich wird im Bericht protokolliert.
- **Versionsordner-Vergleich**: Namen mit `fixed`/`final` sowie bestehende Kopie-/Backup-/Alt-Muster werden besser gruppiert und nur nach vollständigem SHA-256-Vergleich automatisch freigegeben.
- Automatik-Schutz: Android-/App-Strukturen, versteckte Ordner, MIUI/Xiaomi, downloaded_rom, WhatsApp, DCIM/Kamera, Pictures/Bilder, Documents sowie APK/AAB-Dateien werden nicht automatisch gelöscht. Leere Ordner werden unmittelbar vor dem Löschen erneut geprüft.
- Ausschluss von \`/Android/data\` und \`/Android/obb\`.
- Scanbericht als TXT unter \`Dokumente/KC_SpeicherCheck/\`.
- Update-Prüfung über GitHub: manuell per Button und höchstens einmal täglich beim App-Start.
- APK-Updates werden nur nach Freigabe geladen und vor der Installation per SHA-256 geprüft.

## Datenschutz / Sicherheit
Der Speicher-Scan bleibt vollständig lokal. Internetzugriff wird ausschließlich für die Update-Prüfung und den von dir freigegebenen Update-Download verwendet. Die automatische Bereinigung läuft ausschließlich nach einem bewussten Knopfdruck und einer zusammengefassten Sicherheitsabfrage. Leere Ordner werden nur außerhalb geschützter Bereiche berücksichtigt und direkt vor dem Löschen erneut auf Leerstand geprüft.

## Update-Kanal
Die App liest:
\`https://raw.githubusercontent.com/Sire65/KC-System-Check/main/android/kc-speichercheck/update.json\`

Für eine neue Version müssen dort \`versionCode\`, \`versionName\`, \`apkUrl\` und die SHA-256-Prüfsumme der APK aktualisiert werden.

**Wichtig:** Jede installierbare Folgeversion muss mit demselben Android-Signierschlüssel wie die erste installierte Release-APK signiert werden. Den privaten Signierschlüssel niemals in GitHub einchecken.

## Installation/Build
Projekt in Android Studio öffnen und APK bauen. Min SDK 26, Target/Compile SDK 35.

Aktuelle Quellversion: **1.4.6** (\`versionCode 24\`).
