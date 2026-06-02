# PoH Miner Wallet (React Native)

Real POH crypto wallet for the PoH Miner Network.

Connects to any running miner node (port 3456 by default) for **live balances**, **real sends**, transaction history, and notifications.

## Features
- Create new address (node-compatible derivation using SHA256)
- Import by private key (paste the hex from CLI or another device)
- Live balance polling from the node every ~8 seconds
- Send POH — calls the real `POST /api/wallet/send` on your node
- Receive screen with copyable address
- Full Tx history (node + local pending, merged)
- Local push notifications on send success and incoming funds
- Persistent wallets + selected wallet + node URL (AsyncStorage + SecureStore for keys)
- Tab bar navigation (Home / Send / Receive / History / Wallets / Node settings)

## Important Demo Notes
- Real sends only succeed when the **from** address exists in the target node's `~/.poh-miner/wallets/` directory.
  - Easy flow: On the machine running the node, run `poh-miner wallet create`, then import the **same private key** you have in the mobile app.

## Code Structure (2026 Refactor)

The app was originally one giant `App.js` (>3200 lines). It has been restructured for open source:

See [RESTRUCTURE.md](./RESTRUCTURE.md) for the new `src/` layout (services, i18n, screens, components).

This makes the codebase much more maintainable and contributor-friendly while preserving all functionality (multi-node failover, full 20-language live i18n, real crypto wallet behavior, etc.).
  - Or send from the miner's own reward wallet address.
- This is a lightweight client talking to the node's simple ledger API. Full signed on-chain txs will come later.

## Quick Start

1. Install dependencies (from the `poh-miner-wallet` folder):

```bash
npx expo install expo-crypto expo-notifications expo-secure-store @react-native-async-storage/async-storage
```

2. Start the wallet:

```bash
npx expo start
```

3. Run a miner node somewhere (it starts the Wallet API on :3456 automatically).

4. In the wallet → Node tab, set the URL (e.g. `http://192.168.1.50:3456` or `http://localhost:3456` for same machine testing).

5. Create or import a wallet. Send/receive against the node.

## Building an Android APK

The recommended way to build a standalone `.apk` is using **EAS Build**.

### Prerequisites
- An [Expo account](https://expo.dev) (free)
- Node.js installed

### Step-by-step (Recommended)

1. **Go to the wallet directory**
   ```bash
   cd Desktop/poh/miner/poh-miner-wallet
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install EAS CLI globally** (if you haven't already)
   ```bash
   npm install -g eas-cli
   ```

4. **Log in to Expo**
   ```bash
   eas login
   ```

5. **Configure EAS for the first time** (creates `eas.json` and `app.json`)
   ```bash
   eas build:configure
   ```
   - Select **Android** when prompted.

6. **Build the APK**
   ```bash
   eas build -p android --profile preview
   ```

   The `--profile preview` gives you a standard `.apk` that can be installed directly on Android devices (no Google Play signing required).

7. **Download the APK**
   - Once the build finishes, EAS will provide a download link.
   - Download the `.apk` file.
   - Rename it to `poh-miner-wallet.apk` for consistency.

8. **Place it in the landing page** (so the download button works)
   ```bash
   cp poh-miner-wallet.apk ../poh-miner-network/landing/binaries/
   ```

### Alternative: Local Build

If you prefer to build locally without EAS cloud:

- Set up Android Studio + Android SDK
- Run `npx expo prebuild` to generate native Android project
- Open the `android/` folder in Android Studio and build the APK from there

This is more involved but gives you full control.

---

This is the real-feeling POH coin wallet for the network — send, receive, balance updates, tx log, notifications, create/import all work.
