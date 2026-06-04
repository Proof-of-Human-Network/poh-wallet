import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, Alert, TouchableOpacity,
  FlatList, ActivityIndicator, SafeAreaView, StatusBar, ScrollView, Platform, Modal
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
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
  const [sendQrVisible, setSendQrVisible] = useState(false);
  const [sendCamPermission, requestSendCamPermission] = useCameraPermissions();

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

  const Header = ({ title }) => (
    <View style={styles.header}>
      <Text style={styles.title}>{title || t('app.title')}</Text>
      <TouchableOpacity onPress={() => setCurrentScreen('settings')}>
        <Text style={styles.settingsIcon}>⚙</Text>
      </TouchableOpacity>
    </View>
  );

  const TabBar = () => {
    const tabs = [
      { key: 'home',     icon: '●', iconOff: '○', label: t('tab.home') },
      { key: 'history',  icon: '⇄', iconOff: '⇄', label: t('tab.history') },
      { key: 'search',   icon: '⊙', iconOff: '⊙', label: 'Scan' },
      { key: 'settings', icon: '⚙', iconOff: '⚙', label: 'Settings' },
    ];

    return (
      <View style={styles.tabBar}>
        {tabs.map(tab => {
          const isActive = currentScreen === tab.key || (tab.key === 'settings' && currentScreen === 'wallets');
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tab}
              onPress={() => setCurrentScreen(tab.key)}
            >
              <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>
                {isActive ? tab.icon : tab.iconOff}
              </Text>
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
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

        {/* Balance card */}
        <View style={styles.card}>
          <Text style={styles.label}>AVAILABLE BALANCE</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 }}>
            <Text style={styles.balance}>{currentBalance.toFixed(2)}</Text>
            <Text style={styles.balanceCurrency}> POH</Text>
          </View>
          <Text style={styles.usd}>≈ ${(currentBalance * 1.50).toFixed(2)} USD</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
            {loading && <ActivityIndicator color="#22c55e" size="small" style={{ marginRight: 8 }} />}
            <TouchableOpacity onPress={copyAddress} style={{ flex: 1 }}>
              <Text style={styles.addressSmall} numberOfLines={1}>
                {selectedAddress
                  ? `${selectedAddress.slice(0, 8)}…${selectedAddress.slice(-6)}`
                  : t('home.no_wallet')}
              </Text>
            </TouchableOpacity>
            {lastSync && <Text style={styles.sync}>{lastSync.toLocaleTimeString()}</Text>}
          </View>
        </View>

        {/* Action row */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setCurrentScreen('send')}>
            <Text style={styles.actionIcon}>↑</Text>
            <Text style={styles.actionText}>{t('action.send')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setCurrentScreen('receive')}>
            <Text style={styles.actionIcon}>↓</Text>
            <Text style={styles.actionText}>{t('action.receive')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setCurrentScreen('search')}>
            <Text style={[styles.actionIcon, { color: '#22c55e' }]}>⊙</Text>
            <Text style={styles.actionText}>Scan</Text>
          </TouchableOpacity>
        </View>

        {/* Recent */}
        <View style={styles.section}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>RECENT</Text>
            <TouchableOpacity onPress={() => refreshAll(false)}>
              <Text style={{ color: '#22c55e', fontSize: 11, fontFamily: 'Iceland_400Regular' }}>{t('home.refresh')}</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={txs.slice(0, 8)}
            keyExtractor={(item, idx) => item.id || String(idx)}
            contentContainerStyle={{ paddingBottom: 20 }}
            renderItem={({ item }) => {
              const isOut = item.from === selectedAddress;
              const isMining = item.type === 'mining' || item.type === 'reward';
              const counterparty = isOut ? item.to : item.from;
              return (
                <View style={styles.txRow}>
                  <View style={[styles.txCircle, isOut && { backgroundColor: '#160a0a' }]}>
                    <Text style={{ fontSize: 13, color: isMining ? '#22c55e' : isOut ? '#ef4444' : '#22c55e' }}>
                      {isMining ? '⛏' : isOut ? '↑' : '↓'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txType}>{item.type || (isOut ? t('history.sent') : t('history.received'))}</Text>
                    <Text style={styles.txAddr} numberOfLines={1}>
                      {counterparty ? `${counterparty.slice(0, 8)}…${counterparty.slice(-4)}` : (item.status || t('status.confirmed'))}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.txAmount, isOut && { color: '#ef4444' }]}>
                      {isOut ? '-' : '+'}{Number(item.amount || 0).toFixed(2)}
                    </Text>
                    <Text style={styles.txStatus}>POH</Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={{ color: '#374151', marginTop: 8, fontSize: 12, fontFamily: 'Iceland_400Regular' }}>
                {t('home.no_tx')}
              </Text>
            }
          />
        </View>

        <TabBar />
      </SafeAreaView>
    );
  }

  if (currentScreen === 'send') {
    const fee = 0.001;
    const amountNum = parseFloat(sendAmount) || 0;
    return (
      <SafeAreaView style={styles.container} onLayout={onLayoutRootView}>
        <StatusBar barStyle="light-content" />
        <Header title={t('send.title')} />
        <ScrollView contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">

          <Text style={styles.fieldLabel}>TO</Text>
          <View style={styles.toRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder={t('send.recipient_placeholder')}
              placeholderTextColor="#4b5563"
              value={sendTo}
              onChangeText={setSendTo}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.qrBtn}
              onPress={async () => {
                if (!sendCamPermission?.granted) {
                  const res = await requestSendCamPermission();
                  if (!res.granted) {
                    Alert.alert('Camera permission needed', 'Allow camera access to scan QR codes.');
                    return;
                  }
                }
                setSendQrVisible(true);
              }}
            >
              <Text style={styles.qrBtnText}>⊙</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 8 }]}>AMOUNT</Text>
          <View style={styles.amountCard}>
            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor="#374151"
              value={sendAmount}
              onChangeText={setSendAmount}
              keyboardType="decimal-pad"
              textAlign="center"
            />
            <Text style={styles.amountCurrency}>POH</Text>
            <Text style={styles.amountAvail}>Available: {currentBalance.toFixed(2)} POH</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            {[1, 5, 10].map(amt => (
              <TouchableOpacity key={amt} style={styles.presetBtn} onPress={() => setSendAmount(String(amt))}>
                <Text style={styles.presetText}>{amt} POH</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.presetBtn} onPress={() => setSendAmount(String(Math.max(0, currentBalance - fee).toFixed(3)))}>
              <Text style={styles.presetText}>MAX</Text>
            </TouchableOpacity>
          </View>

          {(amountNum > 0 || sendTo.length > 0) ? (
            <View style={styles.summaryCard}>
              <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>SUMMARY</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Sending</Text>
                <Text style={styles.summaryValue}>{amountNum.toFixed(2)} POH</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>To</Text>
                <Text style={[styles.summaryValue, { color: '#6b7280' }]} numberOfLines={1}>
                  {sendTo ? `${sendTo.slice(0, 10)}…${sendTo.slice(-6)}` : '—'}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Fee</Text>
                <Text style={[styles.summaryValue, { color: '#374151' }]}>{fee} POH</Text>
              </View>
            </View>
          ) : null}

          <TouchableOpacity style={[styles.primaryBtn, { marginTop: 16 }]} onPress={send} disabled={loading}>
            {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryBtnText}>Confirm &amp; Send</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setCurrentScreen('home')}>
            <Text style={{ color: '#6b7280', fontFamily: 'Iceland_400Regular' }}>{t('send.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* QR Scanner Modal */}
        <Modal visible={sendQrVisible} transparent={false} animationType="slide" onRequestClose={() => setSendQrVisible(false)}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <View style={styles.qrModalHeader}>
              <Text style={styles.qrModalTitle}>Scan PoH Address</Text>
            </View>
            {sendCamPermission?.granted ? (
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => {
                  if (data) {
                    setSendTo(data.trim());
                    setSendQrVisible(false);
                  }
                }}
              />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontFamily: 'Iceland_400Regular' }}>Camera permission required</Text>
              </View>
            )}
            {/* Aim guide overlay */}
            <View style={styles.qrAimOverlay} pointerEvents="none">
              <View style={styles.qrAimBox} />
            </View>
            <TouchableOpacity style={styles.qrModalClose} onPress={() => setSendQrVisible(false)}>
              <Text style={styles.qrModalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Modal>

        <TabBar />
      </SafeAreaView>
    );
  }

  if (currentScreen === 'receive') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <Header title={t('receive.title')} />

        <View style={[styles.card, { alignItems: 'center', paddingVertical: 32 }]}>
          <Text style={styles.sectionTitle}>RECEIVE POH</Text>
          {selectedAddress ? (
            <View style={{ backgroundColor: '#fff', padding: 14, borderRadius: 4, marginTop: 16 }}>
              <QRCode value={selectedAddress} size={200} color="#000" backgroundColor="#fff" />
            </View>
          ) : (
            <Text style={{ color: '#4b5563', marginTop: 16, fontFamily: 'Iceland_400Regular' }}>{t('receive.no_wallet')}</Text>
          )}
          <TouchableOpacity onPress={copyAddress} style={{ marginTop: 20, alignItems: 'center' }}>
            <Text style={{ color: '#374151', fontSize: 11, fontFamily: 'Iceland_400Regular', textAlign: 'center' }} numberOfLines={1}>
              {selectedAddress || t('receive.no_address')}
            </Text>
            <Text style={{ color: '#22c55e', fontSize: 12, marginTop: 8, fontFamily: 'Iceland_400Regular' }}>
              {t('receive.tap_to_copy')}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setCurrentScreen('home')}>
          <Text style={{ color: '#6b7280', fontFamily: 'Iceland_400Regular' }}>{t('receive.back')}</Text>
        </TouchableOpacity>
        <TabBar />
      </SafeAreaView>
    );
  }

  if (currentScreen === 'history') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <Header title={t('history.title')} />
        <FlatList
          data={txs}
          keyExtractor={(item, i) => item.id || String(i)}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListHeaderComponent={
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={styles.sectionTitle}>ALL TRANSACTIONS</Text>
              <TouchableOpacity onPress={() => refreshAll(false)}>
                <Text style={{ color: '#22c55e', fontSize: 11, fontFamily: 'Iceland_400Regular' }}>{t('history.refresh')}</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const isOut = item.from === selectedAddress;
            const isMining = item.type === 'mining' || item.type === 'reward';
            return (
              <View style={styles.txRow}>
                <View style={[styles.txCircle, isOut && { backgroundColor: '#160a0a' }]}>
                  <Text style={{ fontSize: 13, color: isMining ? '#22c55e' : isOut ? '#ef4444' : '#22c55e' }}>
                    {isMining ? '⛏' : isOut ? '↑' : '↓'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txType}>{(isOut ? t('history.sent') : t('history.received'))} · {item.type || t('history.tx')}</Text>
                  <Text style={styles.txAddr} numberOfLines={1}>
                    {isOut
                      ? (item.to ? `${item.to.slice(0, 10)}…${item.to.slice(-4)}` : '')
                      : (item.from ? `${item.from.slice(0, 10)}…${item.from.slice(-4)}` : '')}
                  </Text>
                  <Text style={{ color: '#374151', fontSize: 10, fontFamily: 'Iceland_400Regular' }}>
                    {new Date(item.timestamp || Date.now()).toLocaleString()}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.txAmount, isOut && { color: '#ef4444' }]}>
                    {isOut ? '-' : '+'}{Number(item.amount || 0).toFixed(2)}
                  </Text>
                  <Text style={styles.txStatus}>{item.status || t('status.confirmed')}</Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={{ color: '#374151', marginTop: 30, textAlign: 'center', fontFamily: 'Iceland_400Regular' }}>
              {t('history.no_history')}
            </Text>
          }
        />
        <TabBar />
      </SafeAreaView>
    );
  }

  if (currentScreen === 'wallets') {
    return (
      <SafeAreaView style={styles.container} onLayout={onLayoutRootView}>
        <StatusBar barStyle="light-content" />
        <Header title={t('wallets.title')} />
        <ScrollView contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          {wallets.length === 0 && (
            <Text style={{ color: '#4b5563', marginBottom: 20, fontFamily: 'Iceland_400Regular' }}>{t('wallets.none')}</Text>
          )}
          {wallets.map((w, i) => {
            const bal = balances[w.address] || 0;
            const isSel = w.address === selectedAddress;
            return (
              <View key={i} style={[styles.walletRow, isSel && styles.selectedWallet]}>
                <TouchableOpacity style={{ flex: 1 }} onPress={async () => {
                  setSelectedAddress(w.address);
                  await Storage.saveSelectedAddress(w.address);
                  setCurrentScreen('home');
                }}>
                  <Text style={styles.walletAddr} numberOfLines={1}>{w.address}</Text>
                  <Text style={styles.walletBal}>{bal.toFixed(2)} POH</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  try { revealPrivateKey(w.address); }
                  catch (e) { Alert.alert(t('error'), 'Failed to show private key'); }
                }} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
                  <Text style={{ color: '#ef4444', fontSize: 12, fontFamily: 'Iceland_400Regular' }}>{t('wallets.show_key')}</Text>
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
            placeholderTextColor="#4b5563"
            value={importKey}
            onChangeText={setImportKey}
            autoCapitalize="none"
            secureTextEntry
          />
          <TouchableOpacity style={styles.secondaryBtn} onPress={importWallet} disabled={loading}>
            <Text style={{ color: '#22c55e', fontFamily: 'Iceland_400Regular' }}>{t('wallets.import_btn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setCurrentScreen('home')}>
            <Text style={{ color: '#6b7280', fontFamily: 'Iceland_400Regular' }}>{t('wallets.done')}</Text>
          </TouchableOpacity>
        </ScrollView>
        <TabBar />
      </SafeAreaView>
    );
  }

  if (currentScreen === 'search') {
    return (
      <SafeAreaView style={styles.container} onLayout={onLayoutRootView}>
        <StatusBar barStyle="light-content" />
        <Header title="Identity Scanner" />
        <View style={{ flex: 1 }}>
          <AIScreen t={t} wallets={wallets} selectedAddress={selectedAddress} balances={balances} setSelectedAddress={setSelectedAddress} saveSelectedAddress={saveSelected} />
        </View>
        <TabBar />
      </SafeAreaView>
    );
  }

  if (currentScreen === 'settings') {
    return (
      <SafeAreaView style={styles.container} onLayout={onLayoutRootView}>
        <StatusBar barStyle="light-content" />
        <Header title="Settings" />

        {/* Segmented tabs */}
        <View style={{ flexDirection: 'row', marginBottom: 16, backgroundColor: '#111', borderRadius: 4, padding: 3 }}>
          {[
            { key: 'nodes',    label: t('settings.nodes_tab') },
            { key: 'language', label: t('settings.language_tab') },
            { key: 'wallets',  label: 'Wallets' },
            { key: 'danger',   label: t('settings.danger_tab') },
          ].map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={{
                flex: 1, paddingVertical: 9, borderRadius: 3, alignItems: 'center',
                backgroundColor: settingsTab === tab.key
                  ? (tab.key === 'danger' ? '#ef4444' : '#22c55e')
                  : 'transparent',
              }}
              onPress={() => setSettingsTab(tab.key)}
            >
              <Text style={{
                color: settingsTab === tab.key
                  ? (tab.key === 'danger' ? '#fff' : '#000')
                  : (tab.key === 'danger' ? '#ef4444' : '#9ca3af'),
                fontWeight: '700', fontFamily: 'Iceland_400Regular', fontSize: 13,
              }}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
          {settingsTab === 'nodes' ? (
            <>
              <Text style={{ color: '#4b5563', marginBottom: 12, fontSize: 13, fontFamily: 'Iceland_400Regular' }}>
                {t('settings.nodes_desc')}
              </Text>
              {nodes.length === 0 && (
                <Text style={{ color: '#4b5563', marginBottom: 16, fontFamily: 'Iceland_400Regular' }}>{t('settings.no_nodes')}</Text>
              )}
              {nodes.map((node, index) => {
                const isActive = node.url === activeNodeUrl;
                return (
                  <View key={index} style={[styles.walletRow, isActive && { borderColor: '#22c55e', borderWidth: 1 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.walletAddr} numberOfLines={1}>{node.url}</Text>
                      {node.name && <Text style={{ color: '#4b5563', fontSize: 11, fontFamily: 'Iceland_400Regular' }}>{node.name}</Text>}
                      {node.lastLatency && <Text style={{ color: '#22c55e', fontSize: 11, fontFamily: 'Iceland_400Regular' }}>{node.lastLatency} ms</Text>}
                    </View>
                    {!isActive && (
                      <TouchableOpacity onPress={async () => {
                        setActiveNodeUrl(node.url);
                        await Storage.saveActiveNodeUrl(node.url);
                        await refreshAll(false);
                      }}>
                        <Text style={{ color: '#22c55e', fontFamily: 'Iceland_400Regular', fontSize: 13 }}>{t('settings.use')}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={async () => {
                      const newNodes = nodes.filter((_, i) => i !== index);
                      setNodes(newNodes);
                      await Storage.saveNodes(newNodes);
                      if (isActive && newNodes.length > 0) {
                        setActiveNodeUrl(newNodes[0].url);
                        await Storage.saveActiveNodeUrl(newNodes[0].url);
                      }
                    }} style={{ marginLeft: 12 }}>
                      <Text style={{ color: '#ef4444', fontFamily: 'Iceland_400Regular', fontSize: 13 }}>{t('settings.remove')}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
              <TextInput
                style={styles.input}
                placeholder={t('settings.node_placeholder')}
                placeholderTextColor="#4b5563"
                value={importKey}
                onChangeText={setImportKey}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.primaryBtn} onPress={async () => {
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
              }}>
                <Text style={styles.primaryBtnText}>{t('settings.add_node')}</Text>
              </TouchableOpacity>
            </>
          ) : settingsTab === 'language' ? (
            <>
              <Text style={{ color: '#4b5563', marginBottom: 12, fontSize: 13, fontFamily: 'Iceland_400Regular' }}>
                {t('settings.lang_desc')}
              </Text>
              {SUPPORTED_LANGUAGES.map((lang) => {
                const isActiveLang = lang.code === language;
                return (
                  <TouchableOpacity
                    key={lang.code}
                    style={[styles.walletRow, isActiveLang && { borderColor: '#22c55e', borderWidth: 1 }, { paddingVertical: 10 }]}
                    onPress={() => changeLanguage(lang.code)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.walletAddr}>{lang.nativeName}</Text>
                      <Text style={{ color: '#4b5563', fontSize: 11, fontFamily: 'Iceland_400Regular' }}>{lang.name}</Text>
                    </View>
                    {isActiveLang && (
                      <Text style={{ color: '#22c55e', fontFamily: 'Iceland_400Regular', fontSize: 12 }}>{t('lang.current')}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          ) : settingsTab === 'wallets' ? (
            <>
              {wallets.length === 0 && (
                <Text style={{ color: '#4b5563', marginBottom: 20, fontFamily: 'Iceland_400Regular' }}>{t('wallets.none')}</Text>
              )}
              {wallets.map((w, i) => {
                const bal = balances[w.address] || 0;
                const isSel = w.address === selectedAddress;
                return (
                  <View key={i} style={[styles.walletRow, isSel && styles.selectedWallet]}>
                    <TouchableOpacity style={{ flex: 1 }} onPress={async () => {
                      setSelectedAddress(w.address);
                      await Storage.saveSelectedAddress(w.address);
                      setCurrentScreen('home');
                    }}>
                      <Text style={styles.walletAddr} numberOfLines={1}>{w.address}</Text>
                      <Text style={styles.walletBal}>{bal.toFixed(2)} POH</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => {
                      try { revealPrivateKey(w.address); }
                      catch (e) { Alert.alert(t('error'), 'Failed to show private key'); }
                    }} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={{ color: '#ef4444', fontSize: 12, fontFamily: 'Iceland_400Regular' }}>{t('wallets.show_key')}</Text>
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
                placeholderTextColor="#4b5563"
                value={importKey}
                onChangeText={setImportKey}
                autoCapitalize="none"
                secureTextEntry
              />
              <TouchableOpacity style={styles.secondaryBtn} onPress={importWallet} disabled={loading}>
                <Text style={{ color: '#22c55e', fontFamily: 'Iceland_400Regular' }}>{t('wallets.import_btn')}</Text>
              </TouchableOpacity>
            </>
          ) : settingsTab === 'danger' ? (
            <View style={{ padding: 8 }}>
              <Text style={{ color: '#ef4444', fontSize: 15, fontFamily: 'Iceland_400Regular', marginBottom: 12 }}>
                Danger Zone
              </Text>
              <Text style={{ color: '#4b5563', marginBottom: 16, fontFamily: 'Iceland_400Regular', fontSize: 13 }}>
                These actions are irreversible.
              </Text>
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: '#ef4444', borderWidth: 1, borderRadius: 4 }]}
                onPress={() => {
                  const message = 'This will permanently delete all wallets, private keys, nodes, and transaction history from this device.';
                  const doClear = () => {
                    setLoading(true);
                    clearAllLocalData().finally(() => setLoading(false));
                  };
                  if (Platform.OS === 'web') {
                    if (window.confirm('Clear All Local Data?\n\n' + message)) { doClear(); }
                  } else {
                    Alert.alert('Clear All Local Data?', message, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete Everything', style: 'destructive', onPress: doClear },
                    ]);
                  }
                }}
              >
                <Text style={{ color: '#ef4444', fontFamily: 'Iceland_400Regular' }}>
                  Clear All Local Wallets &amp; Data
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setCurrentScreen('home')}>
          <Text style={{ color: '#6b7280', fontFamily: 'Iceland_400Regular' }}>{t('wallets.done')}</Text>
        </TouchableOpacity>

        <TabBar />
      </SafeAreaView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: 50, paddingBottom: 95, paddingHorizontal: 20 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 20, color: '#fff', fontFamily: 'Iceland_400Regular' },
  settingsIcon: { color: '#6b7280', fontSize: 18 },

  // Balance card
  card: {
    backgroundColor: '#0f1a0f',
    padding: 20,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
  },
  label: { color: '#22c55e', fontSize: 10, letterSpacing: 2, fontFamily: 'Iceland_400Regular' },
  balance: { fontSize: 48, color: '#fff', fontWeight: '200', fontFamily: 'Iceland_400Regular' },
  balanceCurrency: { fontSize: 18, color: '#22c55e', fontFamily: 'Iceland_400Regular', marginBottom: 10 },
  usd: { color: '#4b5563', fontSize: 12, fontFamily: 'Iceland_400Regular', marginTop: 2 },
  addressSmall: { color: '#374151', fontSize: 11, fontFamily: 'Iceland_400Regular' },
  sync: { color: '#374151', fontSize: 10, fontFamily: 'Iceland_400Regular' },

  // Action row
  actions: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  actionBtn: { flex: 1, backgroundColor: '#111', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  actionIcon: { color: '#fff', fontSize: 20, marginBottom: 4 },
  actionText: { color: '#9ca3af', fontSize: 11, fontFamily: 'Iceland_400Regular' },

  // Section
  section: { flex: 1, marginBottom: 12 },
  sectionTitle: { color: '#4b5563', fontSize: 10, letterSpacing: 1.5, fontFamily: 'Iceland_400Regular' },

  // Tx rows
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d0d0d',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  txCircle: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#0f1a0f',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  txType: { color: '#fff', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  txAddr: { color: '#4b5563', fontSize: 10, fontFamily: 'Iceland_400Regular', marginTop: 2 },
  txAmount: { color: '#22c55e', fontSize: 13, fontFamily: 'Iceland_400Regular', fontWeight: '600' },
  txStatus: { color: '#4b5563', fontSize: 10, fontFamily: 'Iceland_400Regular', marginTop: 2 },

  // Inputs
  fieldLabel: { color: '#4b5563', fontSize: 10, letterSpacing: 1.5, fontFamily: 'Iceland_400Regular', marginBottom: 6 },
  input: {
    backgroundColor: '#111', color: '#fff', padding: 14,
    borderRadius: 10, marginBottom: 12, fontSize: 13,
    fontFamily: 'Iceland_400Regular', borderWidth: 1, borderColor: '#1f1f1f',
  },

  // Send amount card
  amountCard: {
    backgroundColor: '#0f1a0f', borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
    borderRadius: 12, paddingVertical: 20, paddingHorizontal: 16, alignItems: 'center',
  },
  amountInput: {
    color: '#fff', fontSize: 42, fontWeight: '200',
    fontFamily: 'Iceland_400Regular', minWidth: 120, textAlign: 'center',
  },
  amountCurrency: { color: '#22c55e', fontSize: 14, fontFamily: 'Iceland_400Regular', marginTop: 2 },
  amountAvail: { color: '#374151', fontSize: 11, fontFamily: 'Iceland_400Regular', marginTop: 8 },

  // Preset buttons
  presetBtn: { flex: 1, backgroundColor: '#111', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  presetText: { color: '#9ca3af', fontSize: 11, fontFamily: 'Iceland_400Regular' },

  // Summary card
  summaryCard: { backgroundColor: '#0d0d0d', borderRadius: 12, padding: 16, marginTop: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  summaryLabel: { color: '#9ca3af', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  summaryValue: { color: '#fff', fontSize: 12, fontFamily: 'Iceland_400Regular' },

  // Buttons
  primaryBtn: { backgroundColor: '#22c55e', padding: 16, borderRadius: 4, alignItems: 'center', marginVertical: 8 },
  primaryBtnText: { color: '#000', fontWeight: '700', fontSize: 16, fontFamily: 'Iceland_400Regular' },
  secondaryBtn: { padding: 14, alignItems: 'center', marginTop: 4 },

  // Screen title (kept for compat)
  screenTitle: { fontSize: 20, color: '#fff', marginBottom: 16, fontFamily: 'Iceland_400Regular' },
  address: { color: '#374151', fontSize: 11, marginTop: 4, fontFamily: 'Iceland_400Regular' },

  // Wallet rows
  walletRow: { backgroundColor: '#111', padding: 14, borderRadius: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  selectedWallet: { borderColor: '#22c55e', borderWidth: 1 },
  walletAddr: { color: '#fff', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  walletBal: { color: '#22c55e', fontSize: 12, marginTop: 3, fontFamily: 'Iceland_400Regular' },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: '#1c1c1c',
    backgroundColor: '#0a0a0a',
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingTop: 8, paddingBottom: 20,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  tabIcon: { fontSize: 16, color: '#374151' },
  tabIconActive: { color: '#22c55e' },
  tabText: { color: '#374151', fontSize: 9, fontFamily: 'Iceland_400Regular', marginTop: 3 },
  tabTextActive: { color: '#22c55e' },

  langRow: { backgroundColor: '#111', padding: 12, borderRadius: 8, marginBottom: 6, flexDirection: 'row', alignItems: 'center' },
  langRowActive: { borderColor: '#22c55e', borderWidth: 1 },

  // Send screen — TO row with QR button
  toRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  qrBtn: {
    width: 46, height: 46,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1f1f1f',
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  qrBtnText: { color: '#22c55e', fontSize: 22 },

  // QR scanner modal
  qrModalHeader: {
    paddingTop: 56, paddingBottom: 16, paddingHorizontal: 20,
    backgroundColor: '#000',
  },
  qrModalTitle: { color: '#fff', fontSize: 18, fontFamily: 'Iceland_400Regular' },
  qrAimOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'none',
  },
  qrAimBox: {
    width: 220, height: 220,
    borderWidth: 2, borderColor: '#22c55e', borderRadius: 12,
    backgroundColor: 'transparent',
  },
  qrModalClose: {
    position: 'absolute', bottom: 40, alignSelf: 'center',
    paddingVertical: 12, paddingHorizontal: 36,
    backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a',
  },
  qrModalCloseText: { color: '#9ca3af', fontSize: 15, fontFamily: 'Iceland_400Regular' },
});
