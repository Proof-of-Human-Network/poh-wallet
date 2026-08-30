import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { createOrder, applyReferralCode } from '../services/p2pClient';
import { STABLE_TICKERS, assetMeta } from '../constants/assets';

const DAI_DECIMALS = 1_000_000_000;

const CURRENCIES = [
  'USDT-ERC20', 'USDT-TRC20', 'USDT-TON', 'USDT-SOL', 'USDT-BEP20',
  'BTC', 'ETH', 'SOL', 'USDC-ERC20', 'Bank Transfer',
];

// On-chain assets: usable as the SELL (base) asset, and as an atomic quote leg.
const ONCHAIN = ['DAI', ...STABLE_TICKERS];

const NETWORK_OPTIONS = {
  'USDT-ERC20':  ['ERC20'],
  'USDT-TRC20':  ['TRC20'],
  'USDT-TON':    ['TON'],
  'USDT-SOL':    ['SOL'],
  'USDT-BEP20':  ['BEP20'],
  'BTC':         ['Lightning', 'On-chain'],
  'ETH':         ['ERC20'],
  'SOL':         ['SOL'],
  'USDC-ERC20':  ['ERC20'],
};

function defaultNetwork(cur) {
  const nets = NETWORK_OPTIONS[cur] || [];
  return nets.length === 1 ? nets[0] : '';
}

export default function CreateOrderScreen({ selectedAddress, activeNodeUrl, getPrivateKey, onNavigate }) {
  const side = 'sell';
  const [baseAsset, setBaseAsset] = useState('DAI');
  const [quoteCurrency, setQuoteCurrency] = useState('USDT-ERC20');
  // On-chain quote → atomic swap (settles instantly, no payment methods needed)
  const atomic = ONCHAIN.includes(quoteCurrency);
  const [daiAmount, setDAIAmount] = useState('');
  const [pricePerDAI, setPricePerDAI] = useState('');
  const [minTrade, setMinTrade] = useState('');
  const [maxTrade, setMaxTrade] = useState('');
  const [methods, setMethods] = useState([{ network: defaultNetwork('USDT-ERC20'), address: '', details: '' }]);
  const [referralCode, setReferralCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Auto-update network when currency changes (single-network currencies)
  useEffect(() => {
    const nets = NETWORK_OPTIONS[quoteCurrency] || [];
    if (nets.length === 1) {
      setMethods(m => m.map(item => ({ ...item, network: nets[0] })));
    }
  }, [quoteCurrency]);

  const addMethod = () => {
    const net = defaultNetwork(quoteCurrency);
    setMethods(m => [...m, { network: net, address: '', details: '' }]);
  };
  const removeMethod = (i) => setMethods(m => m.filter((_, idx) => idx !== i));
  const updateMethod = (i, field, val) =>
    setMethods(m => m.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  const submit = async () => {
    if (!selectedAddress) return Alert.alert('No wallet', 'Select a wallet first.');
    const dai = parseFloat(daiAmount);
    const price = parseFloat(pricePerDAI);
    if (!dai || dai <= 0) return Alert.alert('Invalid', `Enter a valid ${assetMeta(baseAsset).display} amount.`);
    if (!price || price <= 0) return Alert.alert('Invalid', 'Enter a valid price.');
    if (baseAsset === quoteCurrency) return Alert.alert('Invalid', 'Sell asset and payment currency must differ.');
    const validMethods = atomic ? [] : methods.filter(m => m.network.trim());
    if (!atomic && validMethods.length === 0) return Alert.alert('Invalid', 'Add at least one payment method.');

    // Trade limits, checked with the other pre-flight validation so an
    // incoherent order is rejected before a private key is ever unsealed. The
    // node enforces the same rules; this is so the user sees which field is
    // wrong rather than a generic API error.
    const minVal = parseFloat(minTrade) || 0;
    const maxVal = parseFloat(maxTrade) || (dai * price);
    if (minVal < 0) return Alert.alert('Invalid limit', 'Minimum trade cannot be negative.');
    if (!(maxVal > 0)) return Alert.alert('Invalid limit', 'Maximum trade must be greater than zero.');
    if (minVal > maxVal) {
      return Alert.alert('Invalid limits', `Minimum (${minVal}) cannot be greater than maximum (${maxVal}).`);
    }
    if (maxVal > dai * price * (1 + 1e-9)) {
      return Alert.alert('Invalid limit', `Maximum (${maxVal}) is more than this order is worth (${(dai * price).toFixed(2)} ${quoteCurrency}).`);
    }

    setSubmitting(true);
    try {
      const privateKey = await getPrivateKey(selectedAddress);
      if (!privateKey) return Alert.alert('Error', 'Private key not found. Import your wallet first.');

      // Apply referral code if provided (best-effort, non-blocking)
      if (referralCode.trim()) {
        await applyReferralCode(activeNodeUrl, selectedAddress, referralCode.trim().toUpperCase(), privateKey).catch(() => {});
      }

      const baseDecimals = assetMeta(baseAsset).decimals;
      const daiAmountMicro = Math.round(dai * 10 ** baseDecimals);

      const result = await createOrder(activeNodeUrl, {
        address: selectedAddress,
        privateKeyHex: privateKey,
        side,
        daiAmount: daiAmountMicro,
        baseAsset,
        baseDecimals,
        quoteCurrency,
        pricePerDAI: price,
        minTrade: minVal,
        maxTrade: maxVal,
        paymentMethods: validMethods,
      });

      if (result.error) {
        Alert.alert('Error', result.error);
      } else {
        Alert.alert('Order Posted', `Your sell order for ${daiAmount} ${assetMeta(baseAsset).display} has been posted — locked in escrow.${atomic ? ' It settles atomically when taken.' : ''}`, [
          { text: 'OK', onPress: () => onNavigate('p2p') },
        ]);
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => onNavigate('p2p')}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Post Order</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Side — sell only */}
      <View style={styles.section}>
        <Text style={styles.hint}>{atomic
          ? `You sell ${assetMeta(baseAsset).display} for ${assetMeta(quoteCurrency).display} — locked in escrow, settles atomically on-chain when taken. No payment step.`
          : `You offer ${assetMeta(baseAsset).display} for sale — locked in escrow until the buyer pays off-chain, then you release.`}</Text>
      </View>

      {/* Sell asset (base) */}
      <View style={styles.section}>
        <Text style={styles.label}>Sell Asset</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {ONCHAIN.map(a => (
            <TouchableOpacity
              key={a}
              style={[styles.currencyPill, baseAsset === a && styles.currencyPillActive]}
              onPress={() => setBaseAsset(a)}
            >
              <Text style={[styles.currencyPillText, baseAsset === a && styles.currencyPillTextActive]}>{assetMeta(a).display}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Amount */}
      <View style={styles.section}>
        <Text style={styles.label}>{assetMeta(baseAsset).display} Amount</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 100"
          placeholderTextColor="#555"
          keyboardType="numeric"
          value={daiAmount}
          onChangeText={setDAIAmount}
        />
      </View>

      {/* Quote currency */}
      <View style={styles.section}>
        <Text style={styles.label}>Paid in</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {[...ONCHAIN.filter(c => c !== baseAsset), ...CURRENCIES].map(c => (
            <TouchableOpacity
              key={c}
              style={[styles.currencyPill, quoteCurrency === c && styles.currencyPillActive]}
              onPress={() => setQuoteCurrency(c)}
            >
              <Text style={[styles.currencyPillText, quoteCurrency === c && styles.currencyPillTextActive]}>
                {ONCHAIN.includes(c) ? `${assetMeta(c).display} ⚡` : c}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {atomic && <Text style={[styles.hint, { marginTop: 6 }]}>⚡ On-chain payment — the swap settles instantly to both wallets, no payment methods needed.</Text>}
      </View>

      {/* Price */}
      <View style={styles.section}>
        <Text style={styles.label}>Price per {assetMeta(baseAsset).display} ({ONCHAIN.includes(quoteCurrency) ? assetMeta(quoteCurrency).display : quoteCurrency})</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 0.50"
          placeholderTextColor="#555"
          keyboardType="numeric"
          value={pricePerDAI}
          onChangeText={setPricePerDAI}
        />
      </View>

      {/* Trade limits */}
      <View style={styles.section}>
        <Text style={styles.label}>Trade Limits ({quoteCurrency})</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 8 }]}
            placeholder="Min (e.g. 10)"
            placeholderTextColor="#555"
            keyboardType="numeric"
            value={minTrade}
            onChangeText={setMinTrade}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder={`Max (e.g. ${daiAmount && pricePerDAI ? (parseFloat(daiAmount) * parseFloat(pricePerDAI)).toFixed(2) : '500'})`}
            placeholderTextColor="#555"
            keyboardType="numeric"
            value={maxTrade}
            onChangeText={setMaxTrade}
          />
        </View>
      </View>

      {/* Payment methods (off-chain quotes only — atomic swaps need none) */}
      {!atomic && (
      <View style={styles.section}>
        <Text style={styles.label}>Payment Methods</Text>
        {methods.map((m, i) => {
          const nets = NETWORK_OPTIONS[quoteCurrency] || [];
          return (
            <View key={i} style={styles.methodBlock}>
              <View style={styles.methodHeader}>
                <Text style={styles.methodIndex}>Method {i + 1}</Text>
                {i > 0 && (
                  <TouchableOpacity onPress={() => removeMethod(i)}>
                    <Text style={styles.removeBtn}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={[styles.label, { marginBottom: 6 }]}>Network</Text>
              <View style={styles.networkRow}>
                {nets.map(net => (
                  <TouchableOpacity
                    key={net}
                    style={[styles.networkPill, m.network === net && styles.networkPillActive]}
                    onPress={() => updateMethod(i, 'network', net)}
                  >
                    <Text style={[styles.networkPillText, m.network === net && styles.networkPillTextActive]}>{net}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={[styles.input, { marginTop: 10 }]}
                placeholder="Your wallet / account address"
                placeholderTextColor="#555"
                value={m.address}
                onChangeText={v => updateMethod(i, 'address', v)}
              />
              <TextInput
                style={[styles.input, { marginTop: 6 }]}
                placeholder="Extra details (optional)"
                placeholderTextColor="#555"
                value={m.details}
                onChangeText={v => updateMethod(i, 'details', v)}
              />
            </View>
          );
        })}
        <TouchableOpacity style={styles.addMethodBtn} onPress={addMethod}>
          <Text style={styles.addMethodText}>+ Add payment method</Text>
        </TouchableOpacity>
      </View>
      )}

      {/* Referral code */}
      <View style={styles.section}>
        <Text style={styles.label}>Referral Code (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. A1B2C3D4"
          placeholderTextColor="#555"
          autoCapitalize="characters"
          value={referralCode}
          onChangeText={setReferralCode}
        />
      </View>

      {/* Submit */}
      <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
        {submitting
          ? <ActivityIndicator color="#000" />
          : <Text style={styles.submitText}>Post Order</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16 },
  back: { color: '#22c55e', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 20 },
  title: { color: '#fff', fontSize: 18, fontFamily: 'Iceland_400Regular', lineHeight: 26 },

  section: { marginBottom: 20 },
  label: { color: '#aaa', fontSize: 15, fontFamily: 'Iceland_400Regular', lineHeight: 22, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  hint: { color: '#555', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 20, marginTop: 6 },

  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#222',
    borderRadius: 8, color: '#fff', padding: 12,
    fontFamily: 'Iceland_400Regular', lineHeight: 20, fontSize: 14,
  },
  row: { flexDirection: 'row' },

  currencyPill: { borderRadius: 14, borderWidth: 1, borderColor: '#333', paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  currencyPillActive: { borderColor: '#22c55e', backgroundColor: '#052e16' },
  currencyPillText: { color: '#888', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 20 },
  currencyPillTextActive: { color: '#22c55e' },

  methodBlock: { backgroundColor: '#0d0d0d', borderRadius: 8, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#1a1a1a' },
  methodHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  methodIndex: { color: '#666', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 20 },
  removeBtn: { color: '#dc2626', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 20 },
  addMethodBtn: { borderWidth: 1, borderColor: '#333', borderRadius: 8, paddingVertical: 10, alignItems: 'center', borderStyle: 'dashed' },
  addMethodText: { color: '#555', fontFamily: 'Iceland_400Regular', lineHeight: 19, fontSize: 13 },

  networkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  networkPill: { borderRadius: 8, borderWidth: 1, borderColor: '#333', paddingHorizontal: 14, paddingVertical: 7 },
  networkPillActive: { borderColor: '#22c55e', backgroundColor: '#052e16' },
  networkPillText: { color: '#888', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 19 },
  networkPillTextActive: { color: '#22c55e' },

  submitBtn: { backgroundColor: '#22c55e', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitText: { color: '#000', fontSize: 16, fontWeight: '700', fontFamily: 'Iceland_400Regular', lineHeight: 23 },
});
