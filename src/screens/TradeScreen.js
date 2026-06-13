import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, TextInput,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  fetchTrade, fetchOrder, selectOrder,
  markPaymentSent, releaseTrade, cancelTrade, disputeTrade,
} from '../services/p2pClient';

const POH_DECIMALS = 1_000_000_000;

function formatPOH(uPOH) {
  return (uPOH / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatCountdown(ms) {
  if (ms <= 0) return 'Expired';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const STATUS_LABEL = {
  selected: 'Waiting for Payment',
  payment_sent: 'Payment Sent — Awaiting Release',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

const STATUS_COLOR = {
  selected: '#f59e0b',
  payment_sent: '#3b82f6',
  completed: '#22c55e',
  cancelled: '#6b7280',
  disputed: '#dc2626',
};

// OrderDetailScreen: show order + "select / trade" flow.
// Doubles as TradeScreen when tradeId is provided.
export default function TradeScreen({
  selectedAddress, activeNodeUrl, getPrivateKey, onNavigate,
  orderId, tradeId: initialTradeId,
}) {
  const [order, setOrder] = useState(null);
  const [trade, setTrade] = useState(null);
  const [tradeId, setTradeId] = useState(initialTradeId || null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [pohInput, setPohInput] = useState('');   // for select form
  const [countdown, setCountdown] = useState(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [showDisputeInput, setShowDisputeInput] = useState(false);
  const timerRef = useRef(null);

  const loadData = useCallback(async () => {
    if (!activeNodeUrl) return;
    try {
      if (tradeId) {
        const data = await fetchTrade(activeNodeUrl, tradeId);
        setTrade(data.trade);
        setOrder(data.order);
      } else if (orderId) {
        const data = await fetchOrder(activeNodeUrl, orderId);
        setOrder(data.order);
      }
    } catch { /* keep stale */ }
    setLoading(false);
  }, [activeNodeUrl, tradeId, orderId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Countdown timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (trade?.paymentDeadline && !['completed', 'cancelled', 'disputed'].includes(trade?.status)) {
      const tick = () => setCountdown(trade.paymentDeadline - Date.now());
      tick();
      timerRef.current = setInterval(tick, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [trade?.paymentDeadline, trade?.status]);

  // Poll while trade is active
  useEffect(() => {
    if (!tradeId || !activeNodeUrl) return;
    if (['completed', 'cancelled', 'disputed'].includes(trade?.status)) return;
    const poll = setInterval(() => loadData(), 10000);
    return () => clearInterval(poll);
  }, [tradeId, activeNodeUrl, trade?.status, loadData]);

  const withKey = async (fn) => {
    if (!selectedAddress) return Alert.alert('No wallet', 'Select a wallet first.');
    const privateKey = await getPrivateKey(selectedAddress);
    if (!privateKey) return Alert.alert('Error', 'Private key not found. Import your wallet first.');
    return fn(privateKey);
  };

  const doSelect = async () => {
    const poh = parseFloat(pohInput);
    if (!poh || poh <= 0) return Alert.alert('Invalid', 'Enter a valid POH amount.');
    if (!order) return;
    const pohMicro = Math.round(poh * POH_DECIMALS);
    const quoteAmount = poh * order.pricePerPOH;
    if (quoteAmount < (order.minTrade || 0)) return Alert.alert('Too small', `Minimum trade: ${order.minTrade} ${order.quoteCurrency}`);
    if (order.maxTrade && quoteAmount > order.maxTrade) return Alert.alert('Too large', `Maximum trade: ${order.maxTrade} ${order.quoteCurrency}`);

    setActing(true);
    await withKey(async (pk) => {
      try {
        const result = await selectOrder(activeNodeUrl, {
          address: selectedAddress, privateKeyHex: pk,
          orderId: order.id, pohAmount: pohMicro, quoteAmount,
        });
        if (result.error) return Alert.alert('Error', result.error);
        setTrade(result.trade);
        setTradeId(result.trade.id);
        await loadData();
      } catch (e) { Alert.alert('Error', e.message); }
    });
    setActing(false);
  };

  const doAction = async (action, extra = {}) => {
    setActing(true);
    await withKey(async (pk) => {
      try {
        const fns = { 'payment-sent': markPaymentSent, release: releaseTrade, cancel: cancelTrade, dispute: disputeTrade };
        const fn = fns[action];
        if (!fn) return;
        const result = await fn(activeNodeUrl, { address: selectedAddress, privateKeyHex: pk, tradeId, ...extra });
        if (result.error) return Alert.alert('Error', result.error);
        setTrade(result.trade);
        if (action === 'release') {
          Alert.alert('Complete!', 'POH released. Trade is done.', [{ text: 'OK', onPress: () => onNavigate('p2p') }]);
        }
      } catch (e) { Alert.alert('Error', e.message); }
    });
    setActing(false);
    setShowDisputeInput(false);
  };

  const copyToClipboard = (text) => {
    Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Copied to clipboard.');
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#22c55e" size="large" /></View>;

  const isMaker = selectedAddress && order?.maker === selectedAddress;
  const isTaker = selectedAddress && trade?.taker === selectedAddress;

  // ── Order detail view (no trade yet) ──────────────────────────────────────
  if (!trade && order) {
    const isMine = order.maker === selectedAddress;
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => onNavigate('p2p')}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Order Detail</Text>
          <View style={{ width: 50 }} />
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.bigPrice}>{order.pricePerPOH} <Text style={styles.green}>{order.quoteCurrency}</Text></Text>
            <Text style={[styles.badge, styles.sellBadge]}>SELL</Text>
          </View>
          <Text style={styles.meta}>Available: {formatPOH(order.pohAmount)} POH</Text>
          <Text style={styles.meta}>Limit: {order.minTrade} – {order.maxTrade?.toFixed(2)} {order.quoteCurrency}</Text>
          <Text style={styles.meta}>Maker: {order.maker?.slice(0, 24)}…</Text>
        </View>

        <Text style={styles.sectionTitle}>Payment Methods</Text>
        {(order.paymentMethods || []).map((m, i) => (
          <View key={i} style={styles.methodCard}>
            <Text style={styles.methodNetwork}>{m.network}</Text>
            <TouchableOpacity onPress={() => copyToClipboard(m.address)}>
              <Text style={styles.methodAddress}>{m.address}</Text>
            </TouchableOpacity>
            {m.details ? <Text style={styles.methodDetails}>{m.details}</Text> : null}
          </View>
        ))}

        {!isMine && selectedAddress && order.status === 'open' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Place Trade</Text>
            <TextInput
              style={styles.input}
              placeholder="POH amount to trade"
              placeholderTextColor="#555"
              keyboardType="numeric"
              value={pohInput}
              onChangeText={setPohInput}
            />
            {pohInput && parseFloat(pohInput) > 0 && (
              <Text style={styles.quoteCalc}>
                You pay: {(parseFloat(pohInput) * order.pricePerPOH).toFixed(4)} {order.quoteCurrency}
              </Text>
            )}
            <TouchableOpacity style={styles.actionBtn} onPress={doSelect} disabled={acting}>
              {acting ? <ActivityIndicator color="#000" /> : <Text style={styles.actionBtnText}>Select Order</Text>}
            </TouchableOpacity>
          </View>
        )}

        {isMine && order.status === 'open' && (
          <TouchableOpacity style={[styles.actionBtn, styles.cancelBtn]} onPress={() => onNavigate('myOrders')}>
            <Text style={[styles.actionBtnText, { color: '#dc2626' }]}>Manage in My Orders</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  // ── Active trade view ──────────────────────────────────────────────────────
  if (!trade) return <View style={styles.center}><Text style={{ color: '#666' }}>Trade not found.</Text></View>;

  const statusColor = STATUS_COLOR[trade.status] || '#888';
  const seller    = order?.maker;
  const buyer     = trade.taker;
  const amIBuyer  = selectedAddress === buyer;
  const amISeller = selectedAddress === seller;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => onNavigate('myOrders')}>
          <Text style={styles.back}>← My Orders</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Trade</Text>
        <View style={{ width: 70 }} />
      </View>

      {/* Status */}
      <View style={[styles.statusBanner, { borderColor: statusColor }]}>
        <Text style={[styles.statusText, { color: statusColor }]}>{STATUS_LABEL[trade.status] || trade.status}</Text>
        {countdown !== null && trade.status === 'selected' && (
          <Text style={styles.countdown}>{formatCountdown(countdown)}</Text>
        )}
      </View>

      {/* Trade summary */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Trade Summary</Text>
        <View style={styles.row}>
          <Text style={styles.meta}>POH Amount</Text>
          <Text style={styles.value}>{formatPOH(trade.pohAmount)} POH</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.meta}>Quote Amount</Text>
          <Text style={styles.value}>{trade.quoteAmount?.toFixed(4)} {order?.quoteCurrency}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.meta}>Price</Text>
          <Text style={styles.value}>{order?.pricePerPOH} {order?.quoteCurrency}/POH</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.meta}>Your role</Text>
          <Text style={styles.value}>{amIBuyer ? 'Buyer' : amISeller ? 'Seller' : 'Observer'}</Text>
        </View>
      </View>

      {/* Payment instructions (buyer sends to seller) */}
      {['selected', 'payment_sent'].includes(trade.status) && amIBuyer && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Send Payment To Seller</Text>
          <Text style={styles.instrText}>
            Send exactly <Text style={styles.green}>{trade.quoteAmount?.toFixed(4)} {order?.quoteCurrency}</Text> to:
          </Text>
          {(order?.paymentMethods || []).map((m, i) => (
            <View key={i} style={styles.methodCard}>
              <Text style={styles.methodNetwork}>{m.network}</Text>
              <TouchableOpacity onPress={() => copyToClipboard(m.address)}>
                <Text style={styles.methodAddress}>{m.address} (tap to copy)</Text>
              </TouchableOpacity>
              {m.details ? <Text style={styles.methodDetails}>{m.details}</Text> : null}
            </View>
          ))}
        </View>
      )}

      {/* Seller waiting note */}
      {trade.status === 'selected' && amISeller && (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Waiting for buyer to send <Text style={styles.green}>{trade.quoteAmount?.toFixed(4)} {order?.quoteCurrency}</Text>.
            {'\n'}Your {formatPOH(trade.pohAmount)} POH is locked in escrow.
          </Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.section}>
        {trade.status === 'selected' && amIBuyer && (
          <TouchableOpacity style={styles.actionBtn} onPress={() => doAction('payment-sent')} disabled={acting}>
            {acting ? <ActivityIndicator color="#000" /> : <Text style={styles.actionBtnText}>I've Sent Payment</Text>}
          </TouchableOpacity>
        )}

        {trade.status === 'payment_sent' && amISeller && (
          <>
            <Text style={styles.instrText}>Buyer has marked payment as sent. Verify your account, then release POH.</Text>
            <TouchableOpacity style={styles.actionBtn} onPress={() => doAction('release')} disabled={acting}>
              {acting ? <ActivityIndicator color="#000" /> : <Text style={styles.actionBtnText}>Release POH to Buyer</Text>}
            </TouchableOpacity>
          </>
        )}

        {['selected', 'payment_sent'].includes(trade.status) && (
          <>
            {!showDisputeInput ? (
              <TouchableOpacity style={styles.disputeBtn} onPress={() => setShowDisputeInput(true)}>
                <Text style={styles.disputeBtnText}>Raise Dispute</Text>
              </TouchableOpacity>
            ) : (
              <View>
                <TextInput
                  style={styles.input}
                  placeholder="Describe the issue…"
                  placeholderTextColor="#555"
                  multiline
                  value={disputeReason}
                  onChangeText={setDisputeReason}
                />
                <View style={styles.row}>
                  <TouchableOpacity style={[styles.actionBtn, { flex: 1, marginRight: 8, backgroundColor: '#dc2626' }]}
                    onPress={() => doAction('dispute', { reason: disputeReason })} disabled={acting}>
                    <Text style={styles.actionBtnText}>Submit Dispute</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.cancelBtn, { flex: 1 }]} onPress={() => setShowDisputeInput(false)}>
                    <Text style={[styles.actionBtnText, { color: '#888' }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {trade.status === 'selected' && (
              <TouchableOpacity style={styles.cancelBtn} onPress={() => doAction('cancel')} disabled={acting}>
                <Text style={[styles.actionBtnText, { color: '#6b7280' }]}>Cancel Trade</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {trade.status === 'disputed' && (
          <View style={styles.infoBox}>
            <Text style={[styles.infoText, { color: '#dc2626' }]}>
              This trade is under dispute.{'\n'}Reason: {trade.disputeReason || 'Not specified'}{'\n\n'}
              Contact support@assetux.com with your trade ID: {trade.id}
            </Text>
          </View>
        )}

        {trade.status === 'completed' && (
          <View style={styles.infoBox}>
            <Text style={[styles.infoText, { color: '#22c55e' }]}>Trade completed successfully!</Text>
          </View>
        )}
      </View>

      <Text style={styles.tradeId}>Trade ID: {trade.id?.slice(0, 20)}…</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  back: { color: '#22c55e', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  title: { color: '#fff', fontSize: 18, fontFamily: 'Iceland_400Regular' },

  statusBanner: { marginHorizontal: 16, marginBottom: 12, borderRadius: 8, borderWidth: 1, padding: 12, alignItems: 'center' },
  statusText: { fontSize: 14, fontFamily: 'Iceland_400Regular', fontWeight: '700' },
  countdown: { color: '#f59e0b', fontSize: 24, fontFamily: 'Iceland_400Regular', marginTop: 4 },

  card: { backgroundColor: '#111', borderRadius: 10, padding: 16, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: '#1e1e1e' },
  cardTitle: { color: '#aaa', fontSize: 11, fontFamily: 'Iceland_400Regular', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  bigPrice: { color: '#fff', fontSize: 22, fontFamily: 'Iceland_400Regular' },
  green: { color: '#22c55e' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  meta: { color: '#666', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  value: { color: '#ccc', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  sellBadge: { backgroundColor: '#7f1d1d', color: '#fca5a5' },

  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionTitle: { color: '#aaa', fontSize: 11, fontFamily: 'Iceland_400Regular', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginHorizontal: 16 },
  instrText: { color: '#bbb', fontSize: 13, fontFamily: 'Iceland_400Regular', marginBottom: 10 },
  quoteCalc: { color: '#22c55e', fontFamily: 'Iceland_400Regular', marginBottom: 10 },

  methodCard: { backgroundColor: '#0d0d0d', borderRadius: 8, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#1a1a1a' },
  methodNetwork: { color: '#22c55e', fontSize: 12, fontFamily: 'Iceland_400Regular', marginBottom: 4 },
  methodAddress: { color: '#e5e7eb', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  methodDetails: { color: '#666', fontSize: 11, fontFamily: 'Iceland_400Regular', marginTop: 4 },

  infoBox: { marginHorizontal: 16, backgroundColor: '#0d0d0d', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#1a1a1a' },
  infoText: { color: '#aaa', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 20 },

  actionBtn: { backgroundColor: '#22c55e', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  actionBtnText: { color: '#000', fontWeight: '700', fontSize: 15, fontFamily: 'Iceland_400Regular' },
  cancelBtn: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: '#333' },
  disputeBtn: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: '#dc2626' },
  disputeBtnText: { color: '#dc2626', fontFamily: 'Iceland_400Regular', fontSize: 14 },

  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#222',
    borderRadius: 8, color: '#fff', padding: 12,
    fontFamily: 'Iceland_400Regular', fontSize: 14, marginBottom: 8,
  },
  tradeId: { color: '#333', fontSize: 10, textAlign: 'center', fontFamily: 'Iceland_400Regular', marginVertical: 16 },
});
