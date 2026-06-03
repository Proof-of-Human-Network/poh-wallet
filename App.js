import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, Alert, TouchableOpacity,
  FlatList, ActivityIndicator, SafeAreaView, StatusBar, ScrollView, Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, Iceland_400Regular } from '@expo-google-fonts/iceland';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

// === Clean imports from the new structured src/ ===
import { STORAGE_KEYS, DEFAULT_WALLET_NODES } from './src/constants';
import { createTranslator, detectDefaultLanguage, SUPPORTED_LANGUAGES } from './src/i18n';
import {
  deriveFromPrivateKey,
  generateNewWallet,
} from './src/services/wallet';
import {
  selectBestNode,
} from './src/services/nodeClient';
import * as Storage from './src/services/storage';

import { Header, TabBar, SegmentedControl } from './src/components';
import {
  HomeScreen,
  SendScreen,
  ReceiveScreen,
  HistoryScreen,
  WalletsScreen,
  SettingsScreen,
  AIScreen,
} from './src/screens';

// Keep the splash screen visible while we load fonts
SplashScreen.preventAutoHideAsync();

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});


// deriveFromPrivateKey and generateNewWallet have been moved to src/services/wallet.js
// (imported at the top of this file)

async function registerPushToken(walletAddress, nodeUrl) {
  try {
    const token = await AsyncStorage.getItem('poh_push_token');
    if (!token || !walletAddress || !nodeUrl) return;
    const base = nodeUrl.replace(/\/$/, '');
    await fetch(`${base}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: walletAddress, token, platform: Platform.OS }),
    });
  } catch { /* non-fatal */ }
}

async function showNotification(title, body) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null, // immediate
    });
  } catch (e) {
    // Fallback for environments without full notification support
    console.log('[Notification]', title, body);
  }
}

// ======================
// Multi-Node Management
// ======================

// === Old duplicated storage / node functions removed ===
// Now using src/services/storage.js and src/services/nodeClient.js

export default function PoHMinerWallet() {
  const [fontsLoaded] = useFonts({
    Iceland_400Regular,
  });

  const [currentScreen, setCurrentScreen] = useState('home');
  const [wallets, setWallets] = useState([]); // {address, createdAt}[]
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [balances, setBalances] = useState({}); // address -> number
  const [txs, setTxs] = useState([]);
  const [localPendingTxs, setLocalPendingTxs] = useState([]);

  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [importKey, setImportKey] = useState(''); // reused for "add node" input in Settings

  const [nodes, setNodes] = useState([]);
  const [activeNodeUrl, setActiveNodeUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [language, setLanguage] = useState('en');
  const [settingsTab, setSettingsTab] = useState('nodes'); // 'nodes' | 'language' | 'danger'

  const pollRef = useRef(null);
  const prevBalanceRef = useRef(0);

  const selectedWallet = wallets.find(w => w.address === selectedAddress) || wallets[0] || null;
  const currentBalance = selectedAddress ? (balances[selectedAddress] || 0) : 0;

  // Live translator (recomputed on language change => all strings update)
  const t = createTranslator(language);

  // Language setter with persistence
  const changeLanguage = async (code) => {
    if (!SUPPORTED_LANGUAGES.some(l => l.code === code)) return;
    setLanguage(code);
    await Storage.saveLanguage(code);
  };

  // ===== Persistence (now delegates to src/services/storage.js) =====
  async function saveWallets(list) { await Storage.saveWallets(list); }
  async function saveSelected(addr) { await Storage.saveSelectedAddress(addr); }
  async function saveLocalTxs(list) { await Storage.saveLocalTxs(list); }
  async function saveLang(langCode) { await Storage.saveLanguage(langCode); }

  async function loadPersisted() {
    try {
      const [wStr, sel, nodesStr, activeUrl, lTxStr] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.WALLETS),
        AsyncStorage.getItem(STORAGE_KEYS.SELECTED),
        AsyncStorage.getItem(STORAGE_KEYS.NODES),
        AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_NODE_URL),
        AsyncStorage.getItem(STORAGE_KEYS.LOCAL_TXS),
      ]);
      // Legacy migration key (may not exist)
      let oldNodeUrl = null;
      try {
        oldNodeUrl = await AsyncStorage.getItem(STORAGE_KEYS.NODE_URL);
      } catch (_) {}

      if (wStr) {
        const list = JSON.parse(wStr);
        setWallets(list);
        if (sel && list.find(w => w.address === sel)) {
          setSelectedAddress(sel);
        } else if (list.length > 0) {
          setSelectedAddress(list[0].address);
        }
      }

      let loadedNodes = [];
      if (nodesStr) {
        loadedNodes = JSON.parse(nodesStr);
      } else if (oldNodeUrl) {
        // Migration from old single node
        loadedNodes = [{ url: oldNodeUrl, name: 'Previous Node' }];
      }

      // Seed with default wallet RPC nodes on first launch
      if (loadedNodes.length === 0) {
        loadedNodes = [...DEFAULT_WALLET_NODES];
        await Storage.saveNodes(loadedNodes);
      }

      setNodes(loadedNodes);

      if (activeUrl) {
        setActiveNodeUrl(activeUrl);
      } else if (loadedNodes.length > 0) {
        // Pick first one as default (will be replaced by latency-based selection later)
        setActiveNodeUrl(loadedNodes[0].url);
      }

      if (lTxStr) setLocalPendingTxs(JSON.parse(lTxStr));

      // Language
      const loadedLang = await Storage.loadLanguage();
      if (loadedLang && SUPPORTED_LANGUAGES.some(l => l.code === loadedLang)) {
        setLanguage(loadedLang);
      } else {
        // First run or invalid: auto-detect
        const detected = detectDefaultLanguage();
        setLanguage(detected);
        await Storage.saveLanguage(detected);
      }
    } catch (e) {
      console.log('Load persisted error', e);
    }
  }

  // Store private key securely
  // On web we fall back to AsyncStorage (less secure, only for development)
  async function storePrivateKey(address, privHex) {
    const key = `poh_pk_${address}`;
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(key, privHex);
    } else {
      await SecureStore.setItemAsync(key, privHex);
    }
  }

  async function getPrivateKey(address) {
    const key = `poh_pk_${address}`;
    if (Platform.OS === 'web') {
      return AsyncStorage.getItem(key);
    } else {
      return SecureStore.getItemAsync(key);
    }
  }

  // === Danger: Clear all local wallet data ===
  async function clearAllLocalData() {
    try {
      console.log('[DangerZone] Starting clear all local data...');

      // 1. Delete all private keys
      const walletsStr = await AsyncStorage.getItem(STORAGE_KEYS.WALLETS);
      if (walletsStr) {
        const wallets = JSON.parse(walletsStr);
        for (const w of wallets) {
          const key = `poh_pk_${w.address}`;
          try {
            if (Platform.OS === 'web') {
              await AsyncStorage.removeItem(key);
            } else {
              await SecureStore.deleteItemAsync(key);
            }
            console.log('[DangerZone] Deleted key for', w.address);
          } catch (e) {
            console.warn('[DangerZone] Failed to delete key for', w.address, e);
          }
        }
      }

      // 2. Clear all relevant AsyncStorage keys
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.WALLETS,
        STORAGE_KEYS.SELECTED,
        STORAGE_KEYS.NODES,
        STORAGE_KEYS.ACTIVE_NODE_URL,
        STORAGE_KEYS.LOCAL_TXS,
        STORAGE_KEYS.NODE_URL, // legacy
      ]);
      console.log('[DangerZone] Cleared AsyncStorage keys');

      // 3. Reset in-memory state
      setWallets([]);
      setSelectedAddress(null);
      setNodes([]);
      setActiveNodeUrl(null);
      setLocalPendingTxs([]);
      setTxs([]);
      setBalances({});

      console.log('[DangerZone] All local data cleared successfully');

      // Show success (works better on native, fallback for web)
      if (Platform.OS === 'web') {
        alert('All local wallets, private keys, and data have been cleared.');
      } else {
        Alert.alert(
          'Data Cleared',
          'All local wallets, private keys, nodes, and transaction history have been deleted.'
        );
      }
    } catch (e) {
      console.error('[DangerZone] Failed to clear data:', e);
      if (Platform.OS === 'web') {
        alert('Failed to clear data: ' + e.message);
      } else {
        Alert.alert('Error', 'Failed to clear data: ' + e.message);
      }
    }
  }

  // ===== Node communication with automatic peer failover =====
  // Tries the active node first, then each remaining peer in latency order.
  async function callNodeApi(path, options = {}, _tried = null) {
    const tried = _tried || new Set();
    const urlToTry = tried.size === 0 ? activeNodeUrl : null;

    // Pick next candidate: active node first, then untried peers by latency
    const candidate = urlToTry ||
      [...nodes]
        .sort((a, b) => (a.lastLatency || 9999) - (b.lastLatency || 9999))
        .map(n => n.url)
        .find(u => !tried.has(u));

    if (!candidate) throw new Error('All nodes unreachable');

    tried.add(candidate);
    try {
      const res = await fetch(`${candidate.replace(/\/$/, '')}${path}`, options);
      // If we failed over to a different node, persist the switch
      if (candidate !== activeNodeUrl) {
        setActiveNodeUrl(candidate);
        await Storage.saveActiveNodeUrl(candidate);
      }
      return res;
    } catch {
      return callNodeApi(path, options, tried);
    }
  }

  async function fetchBalance(address, silent = false) {
    const url = activeNodeUrl;
    if (!url || !address) return;
    if (!silent) setLoading(true);
    try {
      const res = await callNodeApi(`/api/wallet/balance?address=${address}`);
      const data = await res.json();
      if (typeof data.balance === 'number') {
        const oldBal = balances[address] || 0;
        const newBal = data.balance;

        setBalances(prev => ({ ...prev, [address]: newBal }));

        // Detect incoming funds -> notification
        if (newBal > oldBal && oldBal > 0) {
          const delta = (newBal - oldBal).toFixed(2);
          showNotification(t('notif.received_title'), t('notif.received_body', { delta, addr: address.slice(0, 12) }));
        }

        setLastSync(new Date());
        prevBalanceRef.current = newBal;
      }
    } catch (e) {
      if (!silent) console.log('All nodes unreachable for balance');
    }
    if (!silent) setLoading(false);
  }

  async function fetchTransactions(address) {
    if (!activeNodeUrl || !address) return;
    try {
      const res = await callNodeApi(`/api/wallet/transactions?address=${address}`);
      const data = await res.json();
      const nodeTxs = Array.isArray(data.transactions) ? data.transactions : [];

      // Merge local pending (optimistic) with node history
      const merged = [...localPendingTxs.filter(t => t.from === address || t.to === address), ...nodeTxs]
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 60);

      setTxs(merged);
    } catch (e) {
      // keep what we have
    }
  }

  async function refreshAll(silent = false) {
    if (!selectedAddress) return;
    await Promise.all([
      fetchBalance(selectedAddress, silent),
      fetchTransactions(selectedAddress),
    ]);
  }

  // Live polling while on home
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    if (currentScreen === 'home' && selectedAddress) {
      refreshAll(true);
      pollRef.current = setInterval(() => {
        refreshAll(true);
      }, 8000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [currentScreen, selectedAddress, activeNodeUrl]);

  // Initial load + notification permission + push token registration
  useEffect(() => {
    loadPersisted();

    (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
          console.log('Notification permission not granted');
          return;
        }
        // Get Expo push token and upload to the active node so the server
        // can send custom push messages to this wallet.
        const tokenData = await Notifications.getExpoPushTokenAsync();
        const token = tokenData?.data;
        if (token) {
          await AsyncStorage.setItem('poh_push_token', token);
          // Upload is deferred until we have an active node (handled in registerPushToken)
        }
      } catch (_) {}
    })();
  }, []);

  // Register push token with the active node whenever wallet or node changes
  useEffect(() => {
    if (selectedAddress && activeNodeUrl) {
      registerPushToken(selectedAddress, activeNodeUrl).catch(() => {});
    }
  }, [selectedAddress, activeNodeUrl]);

  // When selected changes, refresh
  useEffect(() => {
    if (selectedAddress) {
      refreshAll(true);
    }
  }, [selectedAddress]);

  // On startup: select best node by latency
  useEffect(() => {
    if (nodes.length > 0) {
      selectBestNode(nodes).then(async (best) => {
        if (best && best.url !== activeNodeUrl) {
          setActiveNodeUrl(best.url);
          await Storage.saveActiveNodeUrl(best.url);
          // Update nodes with latest latencies
          const updatedNodes = nodes.map(n =>
            n.url === best.url ? { ...n, lastLatency: best.lastLatency } : n
          );
          setNodes(updatedNodes);
          await Storage.saveNodes(updatedNodes);
        }
      });
    }
  }, [nodes.length]); // run when nodes list is loaded

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  // ===== Real wallet creation / import (node compatible) =====
  const createNewWallet = async () => {
    setLoading(true);
    try {
      const { address, privateKey } = await generateNewWallet();

      // Web-compatible private key warning flow
      if (Platform.OS === 'web') {
        const warning = `Address:\n${address}\n\nPRIVATE KEY:\n${privateKey}\n\n` +
          `THIS IS THE ONLY TIME this private key will be shown without extra confirmation.\n\n` +
          `Copy it now and save it in a secure offline location.\n\n` +
          `If you lose this key, you will permanently lose access to your POH funds.`;

        // Show the key using alert (simple but works on web)
        alert(warning);

        // Ask user to copy it
        const copied = window.confirm(
          'Have you copied and safely saved the private key?\n\n' +
          'Click OK only if you have saved it securely. This is your only chance to see it easily.'
        );

        if (!copied) {
          setLoading(false);
          return;
        }

        // Proceed to save the wallet
        try {
          const newEntry = { address, createdAt: Date.now() };
          const updated = [...wallets, newEntry];
          setWallets(updated);
          await Storage.saveWallets(updated);

          await storePrivateKey(address, privateKey);

          setSelectedAddress(address);
          await Storage.saveSelectedAddress(address);

          setBalances(prev => ({ ...prev, [address]: 0 }));

          await showNotification(t('notif.created_title'), t('notif.created_body', { addr: address.slice(0, 18) }));

          alert(
            `Wallet Created!\n\nAddress:\n${address}\n\n` +
            `Your private key is stored securely on this device.\n` +
            `You can view it again later from the Wallets screen (with security warnings).`
          );

          setCurrentScreen('home');
        } catch (e) {
          alert('Error saving wallet: ' + e.message);
        } finally {
          setLoading(false);
        }

        return;
      }

      // Native flow (iOS / Android) - uses Alert.alert as before
      Alert.alert(
        t('create.warning_title'),
        t('create.warning_body', { address, privateKey }),
        [
          {
            text: t('alert.cancel'),
            style: 'cancel',
            onPress: () => setLoading(false),
          },
          {
            text: t('create.copy_pk'),
            onPress: async () => {
              await Clipboard.setStringAsync(privateKey);
              Alert.alert(t('alert.copied'), t('alert.pk_copied'));
            },
          },
          {
            text: t('create.saved_pk'),
            style: 'destructive',
            onPress: async () => {
              try {
                const newEntry = {
                  address,
                  createdAt: Date.now(),
                };

                const updated = [...wallets, newEntry];
                setWallets(updated);
                await Storage.saveWallets(updated);

                await storePrivateKey(address, privateKey);

                setSelectedAddress(address);
                await Storage.saveSelectedAddress(address);

                setBalances(prev => ({ ...prev, [address]: 0 }));

                await showNotification(t('notif.created_title'), t('notif.created_body', { addr: address.slice(0, 18) }));

                Alert.alert(
                  t('create.created_title'),
                  t('create.created_body', { address })
                );

                setCurrentScreen('home');
              } catch (e) {
                Alert.alert(t('create.error_save'), e.message);
              } finally {
                setLoading(false);
              }
            },
          },
        ]
      );
    } catch (e) {
      Alert.alert(t('create.error'), e.message);
      setLoading(false);
    }
  };

  const revealPrivateKey = async (address) => {
    if (Platform.OS === 'web') {
      // Web-friendly flow (Alert.alert is unreliable on web)
      const confirmed = window.confirm(
        'Reveal Private Key?\n\n' +
        'This is a sensitive action.\n\n' +
        'The private key gives full control over this wallet and its funds.\n' +
        'Only reveal it in a private, trusted environment.\n\n' +
        'Are you sure you want to view it now?'
      );

      if (!confirmed) return;

      try {
        const key = await getPrivateKey(address);
        if (!key) {
          alert(t('reveal.error_not_found') || 'Private key not found for this wallet.');
          return;
        }

        // Auto-copy on web for convenience
        try {
          await navigator.clipboard.writeText(key);
        } catch {}

        alert(
          `Address:\n${address}\n\n` +
          `PRIVATE KEY:\n${key}\n\n` +
          '⚠️ NEVER share this key with anyone.\n' +
          'Anyone who has this key can take all your POH.\n\n' +
          '(The key has been copied to your clipboard)'
        );
      } catch (e) {
        alert('Failed to retrieve private key: ' + e.message);
      }
      return;
    }

    // Native flow
    Alert.alert(
      t('reveal.title'),
      t('reveal.body'),
      [
        { text: t('alert.cancel'), style: 'cancel' },
        {
          text: t('reveal.yes'),
          style: 'destructive',
          onPress: async () => {
            try {
              const key = await getPrivateKey(address);
              if (!key) {
                Alert.alert(t('error'), t('reveal.error_not_found'));
                return;
              }

              Alert.alert(
                t('reveal.secret_title'),
                t('reveal.secret_body', { address, privateKey: key }),
                [
                  { text: t('alert.close') },
                  {
                    text: t('create.copy_pk'),
                    onPress: async () => {
                      await Clipboard.setStringAsync(key);
                      Alert.alert(t('alert.copied'), t('alert.pk_copied_short'));
                    }
                  }
                ]
              );
            } catch (e) {
              Alert.alert(t('error'), t('reveal.error'));
            }
          }
        }
      ]
    );
  };

  const importWallet = async () => {
    const key = importKey.trim();
    if (!key || key.length < 32) {
      const msg = t('import.error_invalid');
      if (Platform.OS === 'web') {
        alert(msg);
      } else {
        Alert.alert(t('error'), msg);
      }
      return;
    }
    setLoading(true);
    try {
      const { address, privateKey } = await deriveFromPrivateKey(key);

      // Avoid duplicates
      if (wallets.some(w => w.address === address)) {
        const msg = t('import.already_body');
        if (Platform.OS === 'web') {
          alert(t('import.already') + '\n\n' + msg);
        } else {
          Alert.alert(t('import.already'), msg);
        }
        setImportKey('');
        setLoading(false);
        return;
      }

      const newEntry = { address, createdAt: Date.now() };
      const updated = [...wallets, newEntry];
      setWallets(updated);
      await Storage.saveWallets(updated);

      await storePrivateKey(address, privateKey);

      setSelectedAddress(address);
      await Storage.saveSelectedAddress(address);

      setImportKey('');
      await showNotification(t('notif.imported_title'), t('notif.imported_body', { addr: address.slice(0, 18) }));

      const successMsg = t('import.success_body', { address });
      if (Platform.OS === 'web') {
        alert(t('import.success_title') + '\n\n' + successMsg);
      } else {
        Alert.alert(t('import.success_title'), successMsg);
      }

      setCurrentScreen('home');
    } catch (e) {
      const msg = e.message || t('import.failed');
      if (Platform.OS === 'web') {
        alert('Import failed: ' + msg);
      } else {
        Alert.alert(t('import.failed'), msg);
      }
    }
    setLoading(false);
  };

  // ===== REAL SEND - calls the node =====
  const send = async () => {
    const amount = parseFloat(sendAmount);
    const to = sendTo.trim();

    if (!to || !amount || amount <= 0) {
      Alert.alert(t('error'), t('send.error_invalid'));
      return;
    }
    if (!selectedAddress) {
      Alert.alert(t('send.no_wallet'));
      return;
    }
    if (amount > currentBalance) {
      Alert.alert(t('error'), t('send.insufficient'));
      return;
    }

    setLoading(true);

    const payload = {
      from: selectedAddress,
      to,
      amount,
    };

    const url = activeNodeUrl;
    try {
      const res = await callNodeApi(`/api/wallet/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok || json.error) {
        const msg = json.error || 'Send failed';
        Alert.alert(t('send.failed_title'), t('send.failed_tip', { msg }));
        setLoading(false);
        return;
      }

      // Success path
      const newTx = {
        id: 'local-' + Date.now(),
        type: 'send',
        from: selectedAddress,
        to,
        amount,
        timestamp: Date.now(),
        status: 'confirmed',
      };

      const updatedLocal = [newTx, ...localPendingTxs].slice(0, 200);
      setLocalPendingTxs(updatedLocal);
      await Storage.saveLocalTxs(updatedLocal);

      // Optimistic local balance update
      const newBal = Math.max(0, currentBalance - amount);
      setBalances(prev => ({ ...prev, [selectedAddress]: newBal }));

      // Record in visible tx list immediately
      setTxs(prev => [newTx, ...prev]);

      setSendTo('');
      setSendAmount('');
      setCurrentScreen('home');

      await showNotification(t('notif.tx_sent_title'), t('notif.tx_sent_body', { amount, to: to.slice(0, 12) }));

      // Refresh real state from node shortly after
      setTimeout(() => refreshAll(true), 1200);

      Alert.alert(t('send.success_title'), t('send.success_body', { amount, to }));
    } catch (e) {
      Alert.alert(t('error.network'), t('send.network_error'));
    }

    setLoading(false);
  };

  // ===== UI helpers =====
  const copyAddress = async () => {
    if (!selectedAddress) return;
    try {
      await Clipboard.setStringAsync(selectedAddress);
      if (Platform.OS === 'web') {
        console.log('[Wallet] Address copied to clipboard');
      } else {
        Alert.alert(t('alert.copied'), 'Address copied to clipboard');
      }
    } catch (e) {
      // Fallback for environments where clipboard API fails
      Alert.alert(
        t('alert.your_address'),
        selectedAddress,
        [{ text: t('alert.close') }]
      );
    }
  };

  const Header = () => (
    <View style={styles.header}>
      <Text style={styles.title}>{t('app.title')}</Text>
      <TouchableOpacity onPress={() => setCurrentScreen('settings')}>
        <Text style={{ color: '#22c55e', fontWeight: '600' }}>{t('nav.settings')}</Text>
      </TouchableOpacity>
    </View>
  );

  const TabBar = () => {
    const tabs = [
      { key: 'home', label: t('tab.home') },
      { key: 'history', label: t('tab.history') },
      { key: 'search', label: 'AI' },
      { key: 'wallets', label: t('tab.wallets') },
    ];

    return (
      <View style={styles.tabBar}>
        {tabs.map(tab => {
          const isActive = currentScreen === tab.key;
          const isSearch = tab.key === 'search';
          const tabStyle = isSearch
            ? [styles.centerTab, isActive && styles.tabActive]
            : [styles.tab, isActive && styles.tabActive];
          const textStyle = isSearch
            ? [styles.centerTabText, isActive && styles.tabTextActive]
            : [styles.tabText, isActive && styles.tabTextActive];
          return (
            <TouchableOpacity
              key={tab.key}
              style={tabStyle}
              onPress={() => setCurrentScreen(tab.key)}
            >
              <Text style={textStyle}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // ===== SCREENS =====

  if (currentScreen === 'home') {
    return (
      <SafeAreaView style={styles.container} onLayout={onLayoutRootView}>
        <StatusBar barStyle="light-content" />
        <Header />

        <View style={styles.card}>
          <Text style={styles.label}>{t('home.balance')}</Text>
          <Text style={styles.balance}>{currentBalance.toFixed(2)} POH</Text>
          <TouchableOpacity onPress={copyAddress}>
            <Text style={styles.address} numberOfLines={1}>{selectedAddress || t('home.no_wallet')}</Text>
          </TouchableOpacity>
          {loading && <ActivityIndicator color="#22c55e" style={{ marginTop: 6 }} />}
          {lastSync && <Text style={styles.sync}>{t('home.last_sync')}: {lastSync.toLocaleTimeString()}</Text>}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setCurrentScreen('receive')}>
            <Text style={styles.actionText}>{t('action.receive')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setCurrentScreen('send')}>
            <Text style={styles.actionText}>{t('action.send')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.sectionTitle}>{t('home.recent_activity')}</Text>
            <TouchableOpacity onPress={() => refreshAll(false)}>
              <Text style={{ color: '#22c55e' }}>{t('home.refresh')}</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={txs.slice(0, 8)}
            keyExtractor={(item, idx) => item.id || String(idx)}
            contentContainerStyle={{ paddingBottom: 20 }}
            renderItem={({ item }) => {
              const isOut = item.from === selectedAddress;
              const sign = isOut ? '-' : '+';
              const counterparty = isOut ? item.to : item.from;
              return (
                <View style={styles.txRow}>
                  <Text style={styles.txType}>{item.type || t('history.tx')}</Text>
                  <Text style={styles.txAmount}>{sign}{Number(item.amount || 0).toFixed(2)}</Text>
                  <Text style={styles.txStatus}>{item.status || t('status.confirmed')}</Text>
                  <Text style={styles.txAddr} numberOfLines={1}>{counterparty}</Text>
                </View>
              );
            }}
            ListEmptyComponent={<Text style={{ color: '#555', marginTop: 8 }}>{t('home.no_tx')}</Text>}
          />
        </View>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setCurrentScreen('wallets')}>
          <Text style={{ color: '#22c55e' }}>{t('home.manage_wallets', { count: wallets.length })}</Text>
        </TouchableOpacity>

        <TabBar />
      </SafeAreaView>
    );
  }

  if (currentScreen === 'send') {
    return (
      <SafeAreaView style={styles.container} onLayout={onLayoutRootView}>
        <Header />
        <Text style={styles.screenTitle}>{t('send.title')}</Text>

        <Text style={{ color: '#888', marginBottom: 4 }}>{t('send.from')}</Text>
        <Text style={styles.address}>{selectedAddress}</Text>

        <TextInput
          style={styles.input}
          placeholder={t('send.recipient_placeholder')}
          placeholderTextColor="#666"
          value={sendTo}
          onChangeText={setSendTo}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder={t('send.amount_placeholder')}
          placeholderTextColor="#666"
          value={sendAmount}
          onChangeText={setSendAmount}
          keyboardType="decimal-pad"
        />

        <TouchableOpacity style={styles.primaryBtn} onPress={send} disabled={loading}>
          {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryBtnText}>{t('send.now')}</Text>}
        </TouchableOpacity>

        <Text style={{ color: '#666', fontSize: 12, textAlign: 'center', marginTop: 12 }}>
          {t('send.note')}
        </Text>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setCurrentScreen('home')}>
          <Text>{t('send.cancel')}</Text>
        </TouchableOpacity>
        <TabBar />
      </SafeAreaView>
    );
  }

  if (currentScreen === 'receive') {
    return (
      <SafeAreaView style={styles.container}>
        <Header />
        <Text style={styles.screenTitle}>{t('receive.title')}</Text>

        <View style={[styles.card, { alignItems: 'center', paddingVertical: 24 }]}>
          <Text style={{ color: '#888', marginBottom: 16, fontSize: 14 }}>{t('receive.scan_qr')}</Text>

          {selectedAddress ? (
            <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 4 }}>
              <QRCode
                value={selectedAddress}
                size={220}
                color="#000"
                backgroundColor="#fff"
              />
            </View>
          ) : (
            <Text style={{ color: '#888' }}>{t('receive.no_wallet')}</Text>
          )}

          <TouchableOpacity 
            onPress={copyAddress} 
            style={{ marginTop: 20, paddingHorizontal: 16, paddingVertical: 8 }}
          >
            <Text style={[styles.address, { fontSize: 13, textAlign: 'center' }]} numberOfLines={1}>
              {selectedAddress || t('receive.no_address')}
            </Text>
            <Text style={{ color: '#22c55e', fontSize: 12, marginTop: 6, textAlign: 'center' }}>
              {t('receive.tap_to_copy')}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setCurrentScreen('home')}>
          <Text>{t('receive.back')}</Text>
        </TouchableOpacity>
        <TabBar />
      </SafeAreaView>
    );
  }

  if (currentScreen === 'history') {
    return (
      <SafeAreaView style={styles.container}>
        <Header />
        <Text style={styles.screenTitle}>{t('history.title')}</Text>

        <FlatList
          data={txs}
          keyExtractor={(item, i) => item.id || String(i)}
          contentContainerStyle={{ paddingBottom: 30 }}
          renderItem={({ item }) => {
            const isOut = item.from === selectedAddress;
            return (
              <View style={styles.txRow}>
                <View>
                  <Text style={styles.txType}>{(isOut ? t('history.sent') : t('history.received'))} • {item.type || t('history.tx')}</Text>
                  <Text style={styles.txAddr} numberOfLines={1}>{isOut ? item.to : item.from}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.txAmount}>{isOut ? '-' : '+'}{Number(item.amount || 0).toFixed(2)} POH</Text>
                  <Text style={styles.txStatus}>{item.status || t('status.confirmed')}</Text>
                  <Text style={{ color: '#444', fontSize: 10 }}>{new Date(item.timestamp || Date.now()).toLocaleString()}</Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={<Text style={{ color: '#555', marginTop: 30, textAlign: 'center' }}>{t('history.no_history')}</Text>}
        />

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => refreshAll(false)}>
          <Text>{t('history.refresh')}</Text>
        </TouchableOpacity>
        <TabBar />
      </SafeAreaView>
    );
  }

  if (currentScreen === 'wallets') {
    return (
      <SafeAreaView style={styles.container} onLayout={onLayoutRootView}>
        <Header />
        <Text style={styles.screenTitle}>{t('wallets.title')}</Text>

        {wallets.length === 0 && (
          <Text style={{ color: '#888', marginBottom: 20 }}>{t('wallets.none')}</Text>
        )}

        {wallets.map((w, i) => {
          const bal = balances[w.address] || 0;
          const isSel = w.address === selectedAddress;
          return (
            <View
              key={i}
              style={[styles.walletRow, isSel && styles.selectedWallet]}
            >
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={async () => {
                  setSelectedAddress(w.address);
                  await Storage.saveSelectedAddress(w.address);
                  setCurrentScreen('home');
                }}
              >
                <Text style={styles.walletAddr}>{w.address}</Text>
                <Text style={styles.walletBal}>{bal.toFixed(2)} POH</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  try {
                    revealPrivateKey(w.address);
                  } catch (e) {
                    console.warn('Show Key error:', e);
                    Alert.alert(t('error'), 'Failed to show private key');
                  }
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: '#ef4444', fontSize: 13, fontWeight: '600' }}>{t('wallets.show_key')}</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <TouchableOpacity style={styles.primaryBtn} onPress={createNewWallet} disabled={loading}>
          {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryBtnText}>{t('wallets.create')}</Text>}
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder={t('wallets.import_placeholder')}
          placeholderTextColor="#666"
          value={importKey}
          onChangeText={setImportKey}
          autoCapitalize="none"
          secureTextEntry
        />
        <TouchableOpacity style={styles.secondaryBtn} onPress={importWallet} disabled={loading}>
          <Text>{t('wallets.import_btn')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setCurrentScreen('home')}>
          <Text>{t('wallets.done')}</Text>
        </TouchableOpacity>
        <TabBar />
      </SafeAreaView>
    );
  }

  if (currentScreen === 'search') {
    return (
      <SafeAreaView style={styles.container} onLayout={onLayoutRootView}>
        <StatusBar barStyle="light-content" />
        <Header title="AI" />
        <View style={{ flex: 1 }}>
          <AIScreen t={t} wallets={wallets} selectedAddress={selectedAddress} balances={balances} setSelectedAddress={setSelectedAddress} saveSelectedAddress={saveSelected} />
        </View>
        <TabBar />
      </SafeAreaView>
    );
  }

  // Settings
  if (currentScreen === 'settings') {
    return (
      <SafeAreaView style={styles.container} onLayout={onLayoutRootView}>
        <Header />

        {/* Segmented tabs for Nodes / Language / Danger Zone */}
        <View style={{ flexDirection: 'row', marginBottom: 12, backgroundColor: '#111', borderRadius: 8, padding: 4 }}>
          <TouchableOpacity
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 6,
              alignItems: 'center',
              backgroundColor: settingsTab === 'nodes' ? '#22c55e' : 'transparent',
            }}
            onPress={() => setSettingsTab('nodes')}
          >
            <Text style={{
              color: settingsTab === 'nodes' ? '#000' : '#fff',
              fontWeight: '700',
              fontFamily: 'Iceland_400Regular',
              fontSize: 15
            }}>
              {t('settings.nodes_tab')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 6,
              alignItems: 'center',
              backgroundColor: settingsTab === 'language' ? '#22c55e' : 'transparent',
            }}
            onPress={() => setSettingsTab('language')}
          >
            <Text style={{
              color: settingsTab === 'language' ? '#000' : '#fff',
              fontWeight: '700',
              fontFamily: 'Iceland_400Regular',
              fontSize: 15
            }}>
              {t('settings.language_tab')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 6,
              alignItems: 'center',
              backgroundColor: settingsTab === 'danger' ? '#ef4444' : 'transparent',
            }}
            onPress={() => setSettingsTab('danger')}
          >
            <Text style={{
              color: settingsTab === 'danger' ? '#fff' : '#ef4444',
              fontWeight: '700',
              fontFamily: 'Iceland_400Regular',
              fontSize: 15
            }}>
              {t('settings.danger_tab')}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 140 }}
          keyboardShouldPersistTaps="handled"
        >
          {settingsTab === 'nodes' ? (
            /* ========== NODES TAB ========== */
            <>
              <Text style={{ color: '#888', marginBottom: 12, fontSize: 14 }}>
                {t('settings.nodes_desc')}
              </Text>

              {nodes.length === 0 && (
                <Text style={{ color: '#888', marginBottom: 16 }}>{t('settings.no_nodes')}</Text>
              )}

              {nodes.length > 0 && (
                <Text style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
                  Default nodes are pre-configured. Add more trusted nodes for better resilience.
                </Text>
              )}

              {nodes.map((node, index) => {
                const isActive = node.url === activeNodeUrl;
                return (
                  <View
                    key={index}
                    style={[
                      styles.walletRow,
                      isActive && { borderColor: '#22c55e', borderWidth: 2 }
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.walletAddr}>{node.url}</Text>
                      {node.name && <Text style={{ color: '#888', fontSize: 12 }}>{node.name}</Text>}
                      {node.lastLatency && (
                        <Text style={{ color: '#22c55e', fontSize: 12 }}>
                          {node.lastLatency} ms
                        </Text>
                      )}
                    </View>

                    {!isActive && (
                      <TouchableOpacity
                        onPress={async () => {
                          setActiveNodeUrl(node.url);
                          await Storage.saveActiveNodeUrl(node.url);
                          await refreshAll(false);
                        }}
                      >
                        <Text style={{ color: '#22c55e' }}>{t('settings.use')}</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      onPress={async () => {
                        const newNodes = nodes.filter((_, i) => i !== index);
                        setNodes(newNodes);
                        await Storage.saveNodes(newNodes);

                        if (isActive && newNodes.length > 0) {
                          setActiveNodeUrl(newNodes[0].url);
                          await Storage.saveActiveNodeUrl(newNodes[0].url);
                        }
                      }}
                      style={{ marginLeft: 12 }}
                    >
                      <Text style={{ color: '#ef4444' }}>{t('settings.remove')}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}

              <TextInput
                style={styles.input}
                placeholder={t('settings.node_placeholder')}
                placeholderTextColor="#666"
                value={importKey}
                onChangeText={setImportKey}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={async () => {
                  if (!importKey.trim()) return;

                  const newNode = { url: importKey.trim() };
                  const newNodes = [...nodes, newNode];
                  setNodes(newNodes);
                  await Storage.saveNodes(newNodes);
                  setImportKey('');

                  if (!activeNodeUrl) {
                    setActiveNodeUrl(newNode.url);
                    await Storage.saveActiveNodeUrl(newNode.url);
                  }

                  const best = await selectBestNode(newNodes);
                  if (best) {
                    setActiveNodeUrl(best.url);
                    await Storage.saveActiveNodeUrl(best.url);
                  }
                }}
              >
                <Text style={styles.primaryBtnText}>{t('settings.add_node')}</Text>
              </TouchableOpacity>
            </>
          ) : settingsTab === 'language' ? (
            /* ========== LANGUAGE TAB (scrollable) ========== */
            <>
              <Text style={{ color: '#888', marginBottom: 12, fontSize: 14 }}>
                {t('settings.lang_desc')}
              </Text>

              {SUPPORTED_LANGUAGES.map((lang) => {
                const isActiveLang = lang.code === language;
                return (
                  <TouchableOpacity
                    key={lang.code}
                    style={[
                      styles.walletRow,
                      isActiveLang && { borderColor: '#22c55e', borderWidth: 2 },
                      { paddingVertical: 10 }
                    ]}
                    onPress={() => changeLanguage(lang.code)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.walletAddr}>{lang.nativeName}</Text>
                      <Text style={{ color: '#888', fontSize: 12 }}>{lang.name}</Text>
                    </View>
                    {isActiveLang && (
                      <Text style={{ color: '#22c55e', fontWeight: '600' }}>{t('lang.current')}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          ) : settingsTab === 'danger' ? (
            /* ========== DANGER ZONE TAB ========== */
            <View style={{ padding: 8 }}>
              <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '700', marginBottom: 12 }}>
                Danger Zone
              </Text>
              <Text style={{ color: '#888', marginBottom: 16 }}>
                These actions are irreversible.
              </Text>

              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: '#ef4444', borderWidth: 1, borderRadius: 8 }]}
                onPress={() => {
                  const message = 'This will permanently delete all wallets, private keys, nodes, and transaction history from this device.';

                  const doClear = () => {
                    // Visual feedback while clearing
                    setLoading(true);
                    clearAllLocalData().finally(() => setLoading(false));
                  };

                  if (Platform.OS === 'web') {
                    if (window.confirm('Clear All Local Data?\n\n' + message)) {
                      doClear();
                    }
                  } else {
                    Alert.alert(
                      'Clear All Local Data?',
                      message,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete Everything',
                          style: 'destructive',
                          onPress: doClear,
                        },
                      ]
                    );
                  }
                }}
              >
                <Text style={{ color: '#ef4444', fontWeight: '600' }}>
                  Clear All Local Wallets & Data
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setCurrentScreen('home')}>
          <Text>{t('wallets.done')}</Text>
        </TouchableOpacity>

        <TabBar />
      </SafeAreaView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: 50, paddingBottom: 95, paddingRight: 20, paddingLeft: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 26, color: '#22c55e', fontWeight: '700', fontFamily: 'Iceland_400Regular' },
  screenTitle: { fontSize: 22, color: '#fff', marginBottom: 16, fontWeight: '600', fontFamily: 'Iceland_400Regular' },
  card: { backgroundColor: '#111', padding: 20, borderRadius: 4, marginBottom: 16 },
  balance: { fontSize: 38, color: '#fff', fontWeight: '700', marginVertical: 6, fontFamily: 'Iceland_400Regular' },
  address: { color: '#22c55e', fontSize: 13, marginTop: 4, fontFamily: 'Iceland_400Regular' },
  sync: { color: '#444', fontSize: 11, marginTop: 6 },
  label: { color: '#888', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  actionBtn: { flex: 1, backgroundColor: '#22c55e', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  actionText: { color: '#000', fontWeight: '700', fontSize: 16, fontFamily: 'Iceland_400Regular' },
  section: { marginBottom: 12, flex: 1 },
  sectionTitle: { color: '#fff', fontSize: 15, marginBottom: 8, fontWeight: '600', fontFamily: 'Iceland_400Regular' },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#222' },
  txType: { color: '#22c55e', fontWeight: '600', fontSize: 13 },
  txAmount: { color: '#fff', fontWeight: '600' },
  txStatus: { color: '#666', fontSize: 11 },
  txAddr: { color: '#555', fontSize: 11, maxWidth: 120 },
  input: { backgroundColor: '#111', color: '#fff', padding: 14, borderRadius: 10, marginBottom: 12, fontSize: 15, fontFamily: 'Iceland_400Regular' },
  primaryBtn: { backgroundColor: '#22c55e', padding: 16, borderRadius: 10, alignItems: 'center', marginVertical: 8 },
  primaryBtnText: { color: '#000', fontWeight: '700', fontSize: 16, fontFamily: 'Iceland_400Regular' },
  secondaryBtn: { padding: 14, alignItems: 'center', marginTop: 4 },
  walletRow: { backgroundColor: '#111', padding: 14, borderRadius: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  selectedWallet: { borderColor: '#22c55e', borderWidth: 2 },
  walletAddr: { color: '#fff', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  walletBal: { color: '#22c55e', fontSize: 13, marginTop: 3, fontFamily: 'Iceland_400Regular' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#222',
    backgroundColor: '#000',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 8,
    paddingBottom: 20, // safe area for home indicator / gesture bar
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6 },
  centerTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: '#111',
  },
  tabActive: { borderTopWidth: 3, borderTopColor: '#22c55e' },
  tabText: { color: '#888', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  centerTabText: { color: '#888', fontSize: 12, fontFamily: 'Iceland_400Regular', fontWeight: '600' },
  tabTextActive: { color: '#22c55e', fontWeight: '600', fontFamily: 'Iceland_400Regular' },
  langRow: { backgroundColor: '#111', padding: 12, borderRadius: 8, marginBottom: 6, flexDirection: 'row', alignItems: 'center' },
  langRowActive: { borderColor: '#22c55e', borderWidth: 2 },
});
