# App Assets (PoH Wallet)

**Current status**: Real PoH logo (from network/brain SVG) has been added.

The icons are now using the official PoH logo (green network/brain on dark background).

## Required files (replace these)

| File                    | Recommended Size | Notes                                                                 |
|-------------------------|------------------|-----------------------------------------------------------------------|
| `icon.png`              | 1024×1024        | Main app icon (used on iOS + as fallback)                             |
| `adaptive-icon.png`     | 1024×1024        | **Must have transparent background**. This is the foreground for Android adaptive icons |
| `splash.png`            | ~1242×2436       | Splash screen (optional but recommended)                              |
| `favicon.png`           | 192×192          | Used for web version                                                  |
| `logo.png`              | 256×256          | In-app logo (e.g. in Header) - using official PoH network logo        |

## PoH Logo

The official PoH logo (from the miner network SVG - green network/brain on dark) has been added to all required asset files using the 1024px and 256px renders.

If you ever need to regenerate from the SVG:
- Use the generate-icons.js from the network project, or online tools listed below.
- Recommended tools:
   - https://icon.kitchen
   - https://appicon.co
   - https://easysize.io (good for adaptive icons)

## Build Configuration

- App name is set to **"PoH Wallet"** in `app.json`
- Android package: `com.poh.wallet`
- Icons are configured in `app.json`

## After replacing the icons

```bash
# Clean prebuild (recommended before final build)
npx expo prebuild --clean

# Then build APK using EAS (recommended)
eas build --platform android --profile preview
```

The resulting APK will have:
- Display name: **PoH Wallet**
- Icon: Your PoH logo

---

**Note**: The icons now use the real PoH logo (green network/brain design matching the miner network branding). Ready for builds.
