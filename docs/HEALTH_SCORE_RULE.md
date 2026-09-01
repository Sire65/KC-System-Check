# Gesundheitswert – verbindliche Regel

- 100 % wird nur angezeigt, wenn alle aktuell aktiv konfigurierten und tatsächlich geprüften Systeme im neuesten Lauf `healthy` sind.
- Warnungen oder kritische Befunde senken den Gesundheitswert und verhindern 100 %.
- Nicht konfigurierte Adapter (z. B. Neon ohne Direktcheck, B2 ohne Read-only-Anbindung) werden nicht künstlich grün gerechnet und gehören nicht in One Touch, bis ein echter Check möglich ist.
- Historische Warnungen beeinflussen den aktuellen Gesundheitswert nicht; sie bleiben ausschließlich im Verlauf.
- Die Prüfabdeckung beschreibt nur die aktuell aktiv konfigurierten Prüfsysteme. Alte oder nicht prüfbare Systeme dürfen die Live-Anzeige nicht verfälschen.
