# App Assets (PoH Wallet)

**Current status**: Placeholder icons have been created so builds don't fail immediately.

**You MUST replace them with the real PoH logo** before making a proper release APK.

## Required files (replace these)

| File                    | Recommended Size | Notes                                                                 |
|-------------------------|------------------|-----------------------------------------------------------------------|
| `icon.png`              | 1024×1024        | Main app icon (used on iOS + as fallback)                             |
| `adaptive-icon.png`     | 1024×1024        | **Must have transparent background**. This is the foreground for Android adaptive icons |
| `splash.png`            | ~1242×2436       | Splash screen (optional but recommended)                              |
| `favicon.png`           | 192×192          | Used for web version                                                  |

## How to prepare the PoH logo

1. Take your PoH logo (preferably on transparent background for adaptive icon).
2. Recommended tools:
   - https://icon.kitchen
   - https://appicon.co
   - https://easysize.io (good for adaptive icons)
3. Generate Expo assets and replace the files in this folder.

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

**Note**: The current files in this folder are tiny placeholder PNGs. They will work for testing builds but look bad. Replace them before distributing the app.
