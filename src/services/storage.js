import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '../constants';

/** Simple wrappers around AsyncStorage + SecureStore */

export async function loadItem(key, defaultValue = null) {
  if (typeof key !== 'string' || !key) return defaultValue;
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export async function saveItem(key, value) {
  if (typeof key !== 'string' || !key) return;
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function loadString(key) {
  if (typeof key !== 'string' || !key) return null;
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function saveString(key, value) {
  if (typeof key !== 'string' || !key || !value) return;
  await AsyncStorage.setItem(key, value);
}

// Private keys (sensitive)
export async function storePrivateKey(address, privHex) {
  await SecureStore.setItemAsync(`poh_pk_${address}`, privHex);
}

export async function getPrivateKey(address) {
  return SecureStore.getItemAsync(`poh_pk_${address}`);
}

// High-level wallet persistence helpers
export async function loadWallets() {
  return loadItem(STORAGE_KEYS.WALLETS, []);
}

export async function saveWallets(list) {
  await saveItem(STORAGE_KEYS.WALLETS, list);
}

export async function loadSelectedAddress() {
  return loadString(STORAGE_KEYS.SELECTED);
}

export async function saveSelectedAddress(addr) {
  if (addr) await saveString(STORAGE_KEYS.SELECTED, addr);
}

export async function loadNodes() {
  return loadItem(STORAGE_KEYS.NODES, []);
}

export async function saveNodes(nodes) {
  await saveItem(STORAGE_KEYS.NODES, nodes);
}

export async function loadActiveNodeUrl() {
  return loadString(STORAGE_KEYS.ACTIVE_NODE_URL);
}

export async function saveActiveNodeUrl(url) {
  if (url) await saveString(STORAGE_KEYS.ACTIVE_NODE_URL, url);
}

export async function loadLocalTxs() {
  return loadItem(STORAGE_KEYS.LOCAL_TXS, []);
}

export async function saveLocalTxs(list) {
  await saveItem(STORAGE_KEYS.LOCAL_TXS, list);
}

export async function loadLanguage() {
  return loadString(STORAGE_KEYS.LANG);
}

export async function saveLanguage(lang) {
  if (lang) await saveString(STORAGE_KEYS.LANG, lang);
}
