# PoH Miner Wallet

React Native mobile wallet for the PoH Miner Network. Connects to any running miner node for live balances, token transfers, transaction history, and AI-powered identity scanning.

## Features

- **Multi-wallet** — create or import any number of PoH addresses
- **Live balance** — polls the connected miner node every ~8 s
- **Send / Receive** — real on-chain signed transfers with QR scan
- **Transaction history** — node history merged with local pending txs
- **AI Screen** — submit wallet addresses for human/AI identity verification; displays verdict, confidence, sanctions check (OFAC, EU, UK), and full PoH profile
- **Multi-node failover** — connects to the fastest available node; auto-switches on failure
- **IPFS peer discovery** — when no node is configured or all nodes are offline, discovers active miners from the IPFS peer directory published by the bootnode
- **16 languages** — full live i18n (English, French, Chinese, Spanish, Hindi, Russian, Arabic, and more)
- **Push notifications** — on send success and incoming funds

## Quick Start

```bash
cd poh-miner-wallet
npm install
npx expo start
```

Scan the QR code with **Expo Go** (iOS/Android) or press `a` for Android emulator.

## Building an APK

Uses [EAS Build](https://expo.dev/eas) (free account required):

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview   # produces a .apk
```

The `preview` profile in `eas.json` sets `buildType: "apk"` — no Play Store signing needed.

For a production `.aab` for the Play Store:

```bash
eas build -p android --profile production
```

## Connecting to a Miner Node

The wallet communicates with any `poh-miner-network` node over HTTP.

**Default node:** `https://miner.proofofhuman.ge`

To add your own node: **Settings → Nodes → Add** (e.g. `http://192.168.1.100:3456`).

The wallet tries all configured nodes in parallel and connects to whichever responds first. If all fail, it falls back to IPFS peer discovery.

### Node API used by the wallet

| Endpoint | Purpose |
|---|---|
| `GET /api/wallet/balance?address=` | Live balance |
| `GET /api/wallet/transactions?address=` | Transaction list |
| `POST /api/wallet/send` | Submit transfer |
| `POST /job` | Submit AI identity scan |
| `GET /job/:id/status` | Poll scan status |
| `GET /job/:id/result` | Full verdict + profile + evidence |
| `GET /status` | Node info (chain height, reputation) |
| `POST /api/chat` | Chat with the node's local LLM |
| `GET /api/brain/state` | Brain weights / feedback summary |
| `POST /api/brain/feedback` | Submit human correction |

## IPFS Fallback

When the configured nodes are unreachable, the wallet queries the bootnode for the latest IPFS CIDs and downloads the peer directory from public IPFS gateways (ipfs.io, cloudflare-ipfs.com). This gives the wallet a fresh list of active miner nodes with their `host:port` addresses.

```
wallet → GET bootnode/ipfs/latest → { peers: { cid } }
       → fetch ipfs.io/ipfs/<cid>  → [{host, walletApiPort, wallet, region}]
       → try each peer as an RPC node
```

## AI Screen

The **AI** tab lets you scan any blockchain address for its Proof of Humanity identity:

1. Enter an address (paste or scan QR)
2. The wallet submits a job to the connected miner node
3. The miner runs the full PoH checker (100+ signals across EVM, Solana, Bitcoin, TON, TRON, Stellar) and the AI brain
4. Results show: **HUMAN / AI / UNCERTAIN** verdict with confidence, sanctions check (OFAC, EU, UK), and detailed signal evidence
5. You can submit feedback to correct the AI verdict — this is relayed to the miner network and improves brain weights globally

## Project Structure

```
src/
  screens/
    HomeScreen.js        Balance, recent activity, quick actions
    SendScreen.js        Transfer with address book
    ReceiveScreen.js     QR code display
    HistoryScreen.js     Transaction log
    WalletsScreen.js     Multi-wallet manager
    SettingsScreen.js    Node config, language
    AIScreen.js          Identity scanner + sanctions check
  services/
    nodeClient.js        Multi-node HTTP client + IPFS fallback
    wallet.js            Key generation, signing, storage
    storage.js           AsyncStorage wrappers
  i18n/
    translations.js      16 languages
  components/
    Header.js            Logo + title
    TabBar.js            Bottom navigation
  constants.js           Default nodes, storage keys
App.js                   Root component
```

## Transactions

Transfers are signed `PoHTransaction` objects:

```json
{
  "from": "poh...",
  "to": "poh...",
  "amount": 100000000,
  "fee": 0,
  "nonce": 3,
  "timestamp": 1234567890,
  "txHash": "sha256...",
  "signature": "base64...",
  "signingPublicKey": "-----BEGIN PUBLIC KEY-----..."
}
```

`nonce` is the sender's transaction count — prevents replay attacks. The miner node validates `nonce === account.nonce + 1` before applying. Amounts are in **μPOH** (1 POH = 1,000,000,000 μPOH).
