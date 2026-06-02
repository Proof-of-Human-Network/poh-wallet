# Wallet Code Restructure (April 2026)

The original `App.js` had grown to >3200 lines containing:
- All business logic
- A 20-language translation monster
- Every screen as giant if-blocks
- Crypto, node client, and storage helpers inline

## New Structure

```
src/
├── constants.js                 # STORAGE_KEYS + SUPPORTED_LANGUAGES
├── i18n/
│   ├── index.js
│   └── translations.js          # (can be split into locales/ later)
├── services/
│   ├── wallet.js                # Key derivation + generation
│   ├── nodeClient.js            # Multi-node + failover logic (very important)
│   └── storage.js               # AsyncStorage + SecureStore wrappers
├── components/                  # Reusable UI
│   ├── Header.js
│   ├── TabBar.js
│   ├── SegmentedControl.js
│   └── index.js
├── screens/                     # One file per major view
│   ├── HomeScreen.js
│   ├── SendScreen.js
│   ├── ReceiveScreen.js
│   ├── HistoryScreen.js
│   ├── WalletsScreen.js
│   └── SettingsScreen.js        # Contains Nodes + Language tabs
└── hooks/                       # (future: useI18n, useWallet, etc.)
```

## Current Status

- Foundation and services are extracted.
- App.js is the coordinator (state lives here for now).
- Full screen extraction + prop drilling / context is the next logical step.
- Full 20-language translations need to be restored into `src/i18n/translations.js` from git history if they were lost during the move.

This structure makes the project much more approachable for open-source contributors.

## Recommended Next Steps

1. Move the real translations data into `src/i18n/translations.js`.
2. Fully implement the screen components (move logic out of App.js).
3. Consider a lightweight Context or Zustand for state if prop drilling becomes painful.
4. Add a proper `useI18n` hook.
5. (Later) Consider splitting translations into per-locale files + a build step.

The goal is a clean, professional codebase suitable for an open-source decentralized wallet.
