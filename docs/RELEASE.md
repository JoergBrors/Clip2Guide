# Clip2Guide – Release-Prozess

## Versionierung

Die Version der App wird an **einer einzigen Stelle** gepflegt:

**`package.json`** → `"version": "0.1.0"`

electron-builder liest diese Version automatisch und verwendet sie für:

- Installer-Dateinamen (`Clip2Guide Setup 0.1.0.exe`, `Clip2Guide-0.1.0.dmg`)
- In-App-Versionsnummer (`window.clip2guide.getVersion()`)
- GitHub-Release-Tag (muss manuell übereinstimmen)

---

## CI/CD-Workflow

Datei: `.github/workflows/release.yml`

### Auslöser

```yaml
on:
  push:
    tags:
      - 'v*.*.*'
```

Der Workflow startet ausschließlich bei einem Git-Tag im Format `v0.1.0`.
Pushes auf `main` ohne Tag lösen **keinen** Release aus.

### Jobs

Der Workflow besteht aus zwei Phasen: **Build** (Matrix) → **Publish**.

#### Phase 1: Build-Matrix

| Matrix-Eintrag | Runner | Befehl | Artefakt-Name |
| --- | --- | --- | --- |
| `win x64` | `windows-latest` | `npx electron-builder --win --x64 --publish never` | `installer-win-x64` |
| `mac arm64` | `macos-latest` | `npx electron-builder --mac --arm64 --publish never` | `installer-mac-arm64` |

> **Nur arm64 für macOS:** Die App wird ausschließlich nativ für Apple Silicon gebaut.
> Ein x64-Build via Rosetta-Cross-Compilation wird nicht mehr erzeugt.

#### Build-Schritte (alle Plattformen)

1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node.js 20)
3. `actions/setup-python@v5` (Python 3.13) + `pip install -r requirements.txt`
4. *(macOS only)* `iconutil -c icns icon/icon.iconset -o icon/icon.icns`
5. `npm ci`
6. `npx electron-builder --{platform} --{arch} --publish never`
7. `actions/upload-artifact@v4` – Installer-Dateien hochladen

#### Phase 2: Publish

```yaml
release:
  needs: build
  runs-on: ubuntu-latest
```

Läuft erst, wenn **alle** Build-Jobs erfolgreich waren.

Schritte:

1. Artefakte aller Matrix-Jobs herunterladen
2. `ncipollo/release-action@v1` – GitHub Release mit allen Installer-Dateien erstellen

**GitHub Release enthält:**

- `Clip2Guide Setup {version}.exe` (Windows x64 NSIS-Installer)
- `Clip2Guide-{version}-arm64.dmg` (macOS arm64 / Apple Silicon DMG)

---

## Neuen Release erstellen

### Schritt-für-Schritt

```powershell
# 1. Version in package.json anpassen (manuell editieren)
#    "version": "0.2.0"

# 2. Commit auf main pushen
git add package.json
git commit -m "chore: bump version to 0.2.0"
git push origin main

# 3. Tag erstellen und pushen → löst den Workflow aus
git tag v0.2.0
git push origin v0.2.0
```

### Was dann passiert

1. Alle Build-Jobs starten parallel
2. Windows-Build dauert typisch 4–6 Minuten
3. macOS-Build dauert typisch 5–8 Minuten
4. Sobald alle fertig sind, startet `release`
5. GitHub Release wird automatisch angelegt

---

## Paketierungs-Konfiguration (electron-builder.yml)

```yaml
appId: de.joergbrors.clip2guide
productName: Clip2Guide
directories:
  output: dist
  buildResources: icon

files:
  - dist/renderer/**/*
  - dist/electron/**/*
  - backend/**/*
  - tools/**/*

win:
  target:
    - target: nsis
      arch: [x64]

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true

mac:
  target:
    - target: dmg
  icon: icon/icon.icns
  hardenedRuntime: false
  gatekeeperAssess: false
```

### Wichtige Hinweise zur macOS-Konfiguration

- **`hardenedRuntime: false`**: Die App ist **nicht** von Apple signiert.
  Benutzer müssen den ersten Start manuell freigeben (Systemeinstellungen →
  Datenschutz & Sicherheit → „Trotzdem öffnen").
- **Kein Apple-Developer-Konto** / kein Notarisierungsprozess konfiguriert.
- Die `arch`-Liste wurde **aus `electron-builder.yml` entfernt** – die Architektur
  wird ausschließlich über das CLI-Flag `--arm64` im Workflow gesteuert.
- **Ad-hoc Signierung** im CI verhindert die „App ist beschädigt"-Meldung:
  `codesign --deep --force --sign -` nach dem electron-builder-Schritt.

---

## Lokaler Test-Build

### Windows

```powershell
npm run build:dist
# Ausgabe: dist/Clip2Guide Setup 0.1.0.exe
```

### macOS (arm64 / Apple Silicon)

```bash
npm run build:dist
# Ausgabe: dist/Clip2Guide-0.1.0.dmg  (arm64)
```

---

## Bekannte Probleme und Lösungen

| Problem | Ursache | Lösung |
| --- | --- | --- |
| Leere GitHub Releases-Seite | Build-Job(s) sind fehlgeschlagen → `release`-Job startet nicht | Build-Fehler beheben, neuen Tag pushen |
| Windows-NSIS signiert nicht | Kein Code-Signing-Zertifikat konfiguriert | SmartScreen-Warnung wird Benutzern angezeigt; akzeptabel für interne Tools |
| macOS Gatekeeper blockiert App | `hardenedRuntime: false`, keine Notarisierung | Rechtsklick → „Öffnen"; bei „beschädigt"-Meldung: `xattr -cr /Applications/Clip2Guide.app` |
| `icon.icns` fehlt beim macOS-Build | `icon.icns` ist nicht im Repo (wird im CI generiert) | CI-Schritt `iconutil -c icns icon/icon.iconset -o icon/icon.icns` ist im Workflow |

---

## Artefakte und deren Lebensdauer

GitHub Actions Artefakte (Zwischen-Ergebnisse der Build-Matrix) werden nach
**90 Tagen** automatisch gelöscht. Die eigentlichen Installer in der
**GitHub Release** bleiben dauerhaft erhalten.

---

## Versionierungs-Konvention

Das Projekt nutzt Semantic Versioning (`MAJOR.MINOR.PATCH`):

| Änderungstyp | Version erhöhen |
| --- | --- |
| Breaking Change (z.B. .env-Format geändert) | MAJOR |
| Neue Funktion (neuer Workflow-Schritt, neuer Provider) | MINOR |
| Bugfix, Dokumentation, Refactoring | PATCH |
