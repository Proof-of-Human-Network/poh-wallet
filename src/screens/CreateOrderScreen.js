import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { createOrder } from '../services/p2pClient';

const POH_DECIMALS = 1_000_000_000;

const CURRENCIES = [
  'USDT-ERC20', 'USDT-TRC20', 'USDT-TON', 'USDT-SOL', 'USDT-BEP20',
  'BTC', 'ETH', 'SOL', 'USDC-ERC20',
];

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
  const [quoteCurrency, setQuoteCurrency] = useState('USDT-ERC20');
  const [pohAmount, setPohAmount] = useState('');
  const [pricePerPOH, setPricePerPOH] = useState('');
  const [minTrade, setMinTrade] = useState('');
  const [maxTrade, setMaxTrade] = useState('');
  const [methods, setMethods] = useState([{ network: defaultNetwork('USDT-ERC20'), address: '', details: '' }]);
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
    const poh = parseFloat(pohAmount);
    const price = parseFloat(pricePerPOH);
    if (!poh || poh <= 0) return Alert.alert('Invalid', 'Enter a valid POH amount.');
    if (!price || price <= 0) return Alert.alert('Invalid', 'Enter a valid price.');
    const validMethods = methods.filter(m => m.network.trim());
    if (validMethods.length === 0) return Alert.alert('Invalid', 'Add at least one payment method.');

    setSubmitting(true);
    try {
      const privateKey = await getPrivateKey(selectedAddress);
      if (!privateKey) return Alert.alert('Error', 'Private key not found. Import your wallet first.');

      const pohAmountMicro = Math.round(poh * POH_DECIMALS);
      const minVal = parseFloat(minTrade) || 0;
      const maxVal = parseFloat(maxTrade) || (poh * price);

      const result = await createOrder(activeNodeUrl, {
        address: selectedAddress,
        privateKeyHex: privateKey,
        side,
        pohAmount: pohAmountMicro,
        quoteCurrency,
        pricePerPOH: price,
        minTrade: minVal,
        maxTrade: maxVal,
        paymentMethods: validMethods,
      });

      if (result.error) {
        Alert.alert('Error', result.error);
      } else {
        Alert.alert('Order Posted', `Your sell order for ${pohAmount} POH has been posted. POH is locked in escrow.`, [
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
        <Text style={styles.hint}>You offer POH for sale — POH is locked in escrow until the buyer pays off-chain, then you release.</Text>
      </View>

      {/* Amount */}
      <View style={styles.section}>
        <Text style={styles.label}>POH Amount</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 100"
          placeholderTextColor="#555"
          keyboardType="numeric"
          value={pohAmount}
          onChangeText={setPohAmount}
        />
      </View>

      {/* Quote currency */}
      <View style={styles.section}>
        <Text style={styles.label}>Paid in</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {CURRENCIES.map(c => (
            <TouchableOpacity
              key={c}
              style={[styles.currencyPill, quoteCurrency === c && styles.currencyPillActive]}
              onPress={() => setQuoteCurrency(c)}
            >
              <Text style={[styles.currencyPillText, quoteCurrency === c && styles.currencyPillTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Price */}
      <View style={styles.section}>
        <Text style={styles.label}>Price per POH ({quoteCurrency})</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 0.50"
          placeholderTextColor="#555"
          keyboardType="numeric"
          value={pricePerPOH}
          onChangeText={setPricePerPOH}
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
            placeholder={`Max (e.g. ${pohAmount && pricePerPOH ? (parseFloat(pohAmount) * parseFloat(pricePerPOH)).toFixed(2) : '500'})`}
            placeholderTextColor="#555"
            keyboardType="numeric"
            value={maxTrade}
            onChangeText={setMaxTrade}
          />
        </View>
      </View>

      {/* Payment methods */}
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
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  back: { color: '#22c55e', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  title: { color: '#fff', fontSize: 18, fontFamily: 'Iceland_400Regular' },

  section: { marginHorizontal: 16, marginBottom: 20 },
  label: { color: '#aaa', fontSize: 15, fontFamily: 'Iceland_400Regular', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  hint: { color: '#555', fontSize: 14, fontFamily: 'Iceland_400Regular', marginTop: 6 },

  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#222',
    borderRadius: 8, color: '#fff', padding: 12,
    fontFamily: 'Iceland_400Regular', fontSize: 14,
  },
  row: { flexDirection: 'row' },

  currencyPill: { borderRadius: 14, borderWidth: 1, borderColor: '#333', paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  currencyPillActive: { borderColor: '#22c55e', backgroundColor: '#052e16' },
  currencyPillText: { color: '#888', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  currencyPillTextActive: { color: '#22c55e' },

  methodBlock: { backgroundColor: '#0d0d0d', borderRadius: 8, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#1a1a1a' },
  methodHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  methodIndex: { color: '#666', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  removeBtn: { color: '#dc2626', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  addMethodBtn: { borderWidth: 1, borderColor: '#333', borderRadius: 8, paddingVertical: 10, alignItems: 'center', borderStyle: 'dashed' },
  addMethodText: { color: '#555', fontFamily: 'Iceland_400Regular', fontSize: 13 },

  networkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  networkPill: { borderRadius: 8, borderWidth: 1, borderColor: '#333', paddingHorizontal: 14, paddingVertical: 7 },
  networkPillActive: { borderColor: '#22c55e', backgroundColor: '#052e16' },
  networkPillText: { color: '#888', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  networkPillTextActive: { color: '#22c55e' },

  submitBtn: { marginHorizontal: 16, backgroundColor: '#22c55e', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitText: { color: '#000', fontSize: 16, fontWeight: '700', fontFamily: 'Iceland_400Regular' },
});
