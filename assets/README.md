# App Assets (DAI Wallet)

Icons use the AIHub leaf + wordmark logo (cream `#FEEDE2`, pink leaf, navy “AIHub”).

## Files

| File                    | Size        | Notes                                                                 |
|-------------------------|-------------|-----------------------------------------------------------------------|
| `icon.png`              | 1024×1024   | Main app icon (iOS + Android fallback)                                |
| `adaptive-icon.png`     | 1024×1024   | Android adaptive foreground (inset so the wordmark survives circular crop) |
| `splash.png`            | 720×1280    | Splash on cream `#FEEDE2`                                             |
| `favicon.png`           | 192×192     | Web favicon                                                           |
| `logo.png`              | 256×256     | In-app header logo                                                    |
| `logos/aihub-logo.png`  | 756×756     | Canonical source mark                                                 |

## Build configuration

- App name: **DAI Wallet** (`app.json`)
- Android package: `com.dai.wallet`
- Adaptive icon background: `#FEEDE2`
- Native mipmaps under `android/app/src/main/res/mipmap-*` match this logo

## After replacing the icons

```bash
npx expo prebuild --clean
eas build --platform android --profile preview
```
