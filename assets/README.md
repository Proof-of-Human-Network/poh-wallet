# App Assets (DAI Wallet)

Icons use the DAI wordmark in Iceland (same style as the original POH mark), white on black.

## Files

| File                    | Size        | Notes                                                                 |
|-------------------------|-------------|-----------------------------------------------------------------------|
| `icon.png`              | 1024×1024   | Main app icon (iOS + Android fallback)                                |
| `adaptive-icon.png`     | 1024×1024   | Android adaptive foreground (inset so the wordmark survives circular crop) |
| `splash.png`            | 720×1280    | Splash on black `#000000`                                             |
| `favicon.png`           | 48×48       | Web favicon                                                           |
| `logo.png`              | 1024×1024   | In-app header logo                                                    |

## Build configuration

- App name: **DAI Wallet** (`app.json`)
- Android package: `com.dai.wallet`
- Adaptive icon background: `#000000`
- Native mipmaps under `android/app/src/main/res/mipmap-*` match this logo

## After replacing the icons

```bash
npx expo prebuild --clean
eas build --platform android --profile preview
```
