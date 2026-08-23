// Storage keys used across the wallet
export const STORAGE_KEYS = {
  WALLETS: 'dai_wallets_v2',
  SELECTED: 'dai_selected_address_v2',
  NODES: 'dai_nodes_v1',
  ACTIVE_NODE_URL: 'dai_active_node_url_v1',
  LOCAL_TXS: 'dai_local_txs_v2',
  LANG: 'dai_lang_v1',
  NODE_URL: 'dai_node_url_v1', // legacy (pre multi-node support)
};

// Default public / bootstrap wallet RPC nodes (used when the user has none configured)
export const DEFAULT_WALLET_NODES = [
  { url: 'https://miner.iamai.kg', name: 'Miner (primary)' },
];

// Bootnodes used for peer discovery via /peers (and fallback /ipfs/latest).
// Order: primary is miner.iamai.kg, then others.
export const DEFAULT_BOOTNODES = [
  'https://miner.iamai.kg',
];

// Supported languages for the wallet (top 20 + additional requested languages)
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ka', name: 'Georgian', nativeName: 'ქართული' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی' }
];
