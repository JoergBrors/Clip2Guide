# Clip2Guide – Release-Prozess

## Versionierung

Die Version der App wird über den Git-Tag gesteuert und automatisch synchronisiert.

**CI-Automatik**: Beim Pushen eines Tags `v1.2.3` setzt der CI-Workflow automatisch
`npm version 1.2.3 --no-git-tag-version` → `package.json` muss **nicht** manuell angepasst werden.

electron-builder liest die Version aus `package.json` und verwendet sie für:

- Installer-Dateinamen (`Clip2Guide Setup {version}.exe`, `Clip2Guide-{version}-arm64.pkg`)
- In-App-Versionsnummer (`window.clip2guide.getVersion()`)
- GitHub-Release-Tag

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
3. **Version synchronisieren**: Tag `v0.3.4` → `npm version 0.3.4 --no-git-tag-version` → `package.json`
4. `npm ci`
5. `npm run build` (Vite + Electron TypeScript)
6. *(macOS only)* Icon erzeugen + Ad-hoc Signierung vor und nach dem Packaging
7. `npx electron-builder --{platform} --{arch} --publish never`
8. `actions/upload-artifact@v4` – Installer-Dateien hochladen

> **Versions-Synchronisation**: `package.json` muss vor einem Release-Tag **nicht** manuell
> angepasst werden. Der CI-Schritt überschreibt die Version automatisch aus dem Tag.
> `--no-git-tag-version` verhindert einen zweiten Commit/Tag durch npm.

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
- `Clip2Guide-{version}-arm64.pkg` (macOS arm64 / Apple Silicon PKG-Installer)

---

## Neuen Release erstellen

### Schritt-für-Schritt

```powershell
# 1. Änderungen committen und pushen
git push origin main

# 2. Tag erstellen und pushen → löst den Workflow aus
#    Der CI synchronisiert package.json automatisch auf diese Version.
git tag v0.4.0
git push origin v0.4.0
```

> `package.json` muss **nicht** vorab manuell angepasst werden.
> Der CI-Schritt „Sync version from tag to package.json" setzt die Version
> automatisch auf den Tag-Wert (ohne `v`-Präfix).

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
  - backend/app/**
  - backend/requirements.txt

extraResources:
  - from: initial.ps1
    to: initial.ps1
  - from: initial.sh
    to: initial.sh
  - from: localstuff/env.example
    to: env.example
  - from: backend/requirements.txt
    to: backend/requirements.txt

asarUnpack:
  - "**/*.py"
  - "**/*.pyd"
  - "**/*.so"
  - "**/*.dylib"

win:
  target:
    - target: nsis
      arch: [x64]
  artifactName: "Clip2Guide-${version}-${arch}-${os}.${ext}"

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true

mac:
  target:
    - target: pkg
  icon: icon/icon.icns
  hardenedRuntime: false
  gatekeeperAssess: false
  artifactName: "Clip2Guide-${version}-arm64.${ext}"
```

### Wichtige Hinweise zur macOS-Konfiguration

- **Format: `pkg`** statt `dmg` – der macOS-Installer verarbeitet das PKG nativ und
  umgeht das Quarantine-/Gatekeeper-„App ist beschädigt"-Problem.
- **`artifactName`**: `Clip2Guide-${version}-arm64.pkg` – Version und Architektur
  sind explizit im Dateinamen codiert.
- **`hardenedRuntime: false`**: Die App ist **nicht** von Apple notarisiert.
  Benutzer müssen beim ersten Start Rechtsklick → „Öffnen" verwenden.
- **Kein Apple-Developer-Konto** / kein Notarisierungsprozess konfiguriert.
- Die Architektur wird ausschließlich über das CLI-Flag `--arm64` im Workflow gesteuert.
- **Ad-hoc Signierung** im CI vor und nach dem Packaging:
  `codesign --deep --force --sign -` auf die `.app`.
- **`extraResources`**: `initial.sh`, `initial.ps1`, `env.example` und `backend/requirements.txt`
  landen unter `resources/` in der paketierten App. Das Setup-Skript und `requirements.txt`
  sind damit auch ohne ASAR-Entpacken zugänglich.
- **`asarUnpack`**: Alle `.py`, `.pyd`, `.so`, `.dylib` Dateien werden aus dem ASAR entpackt,
  damit Python sie direkt laden kann.

---

## Lokaler Test-Build

### Windows

```powershell
npm run build:dist
# Ausgabe: dist/Clip2Guide-{version}-x64-win.exe
```

### macOS (arm64 / Apple Silicon)

```bash
npm run build:dist
# Ausgabe: dist/Clip2Guide-{version}-arm64.pkg
```

---

## Bekannte Probleme und Lösungen

| Problem | Ursache | Lösung |
| --- | --- | --- |
| Leere GitHub Releases-Seite | Build-Job(s) sind fehlgeschlagen → `release`-Job startet nicht | Build-Fehler beheben, neuen Tag pushen |
| Windows-NSIS signiert nicht | Kein Code-Signing-Zertifikat konfiguriert | SmartScreen-Warnung wird Benutzern angezeigt; akzeptabel für interne Tools |
| macOS Gatekeeper blockiert App | `hardenedRuntime: false`, keine Notarisierung | Rechtsklick auf PKG → „Öffnen" |
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
