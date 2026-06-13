import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, ScrollView, RefreshControl,
} from 'react-native';
import { fetchOrders, fetchCurrencies } from '../services/p2pClient';

const CURRENCIES = [
  'USDT-ERC20', 'USDT-TRC20', 'USDT-TON', 'USDT-SOL', 'USDT-BEP20',
  'BTC', 'ETH', 'SOL', 'USDC',
];

function formatPOH(uPOH) {
  return (uPOH / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

export default function P2PScreen({ selectedAddress, activeNodeUrl, onNavigate }) {
  const [currency, setCurrency] = useState('USDT-ERC20');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!activeNodeUrl) return;
    if (!silent) setLoading(true);
    try {
      const data = await fetchOrders(activeNodeUrl, { side: 'sell', quoteCurrency: currency, status: 'open' });
      setOrders(data.orders || []);
    } catch { /* keep stale */ }
    setLoading(false);
    setRefreshing(false);
  }, [activeNodeUrl, currency]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  const renderOrder = ({ item: order }) => {
    const pohDisplay = formatPOH(order.pohAmount);
    return (
      <TouchableOpacity
        style={styles.orderCard}
        onPress={() => onNavigate('orderDetail', { orderId: order.id })}
      >
        <View style={styles.orderRow}>
          <Text style={styles.priceText}>
            {order.pricePerPOH} <Text style={styles.currencyBadge}>{order.quoteCurrency}</Text>
          </Text>
          <Text style={[styles.sideBadge, styles.sellBadge]}>SELL</Text>
        </View>
        <View style={styles.orderRow}>
          <Text style={styles.orderMeta}>Amount: {pohDisplay} POH</Text>
          <Text style={styles.orderMeta}>Limit: {order.minTrade}–{order.maxTrade?.toFixed(2)} {order.quoteCurrency}</Text>
        </View>
        <View style={styles.orderRow}>
          <Text style={styles.makerText}>{order.maker?.slice(0, 18)}…</Text>
          <Text style={styles.orderMeta}>{timeAgo(order.createdAt)}</Text>
        </View>
        {order.paymentMethods?.length > 0 && (
          <View style={styles.methodsRow}>
            {order.paymentMethods.slice(0, 3).map((m, i) => (
              <Text key={i} style={styles.methodTag}>{m.network}</Text>
            ))}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>P2P Exchange</Text>
        <TouchableOpacity
          style={styles.myOrdersBtn}
          onPress={() => onNavigate('myOrders')}
        >
          <Text style={styles.myOrdersBtnText}>My Orders</Text>
        </TouchableOpacity>
      </View>

      {/* Currency filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.currencyScroll}>
        {CURRENCIES.map(c => (
          <TouchableOpacity
            key={c}
            style={[styles.currencyPill, currency === c && styles.currencyPillActive]}
            onPress={() => setCurrency(c)}
          >
            <Text style={[styles.currencyPillText, currency === c && styles.currencyPillTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Order list */}
      {loading && !refreshing ? (
        <ActivityIndicator color="#22c55e" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={o => o.id}
          renderItem={renderOrder}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No sell orders for {currency}</Text>
          }
        />
      )}

      {/* Post order button */}
      {selectedAddress && (
        <TouchableOpacity
          style={styles.postBtn}
          onPress={() => onNavigate('createOrder', { defaultSide: 'sell' })}
        >
          <Text style={styles.postBtnText}>+ Post Sell Order</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { color: '#fff', fontSize: 20, fontFamily: 'Iceland_400Regular' },
  myOrdersBtn: { borderWidth: 1, borderColor: '#333', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  myOrdersBtnText: { color: '#aaa', fontSize: 12, fontFamily: 'Iceland_400Regular' },

  currencyScroll: { paddingHorizontal: 12, marginBottom: 8, flexGrow: 0 },
  currencyPill: { borderRadius: 14, borderWidth: 1, borderColor: '#333', paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  currencyPillActive: { borderColor: '#22c55e', backgroundColor: '#052e16' },
  currencyPillText: { color: '#888', fontSize: 11, fontFamily: 'Iceland_400Regular' },
  currencyPillTextActive: { color: '#22c55e' },

  orderCard: { backgroundColor: '#111', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1e1e1e' },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  priceText: { color: '#fff', fontSize: 18, fontFamily: 'Iceland_400Regular' },
  currencyBadge: { color: '#22c55e', fontSize: 13 },
  sideBadge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  sellBadge: { backgroundColor: '#7f1d1d', color: '#fca5a5' },
  orderMeta: { color: '#666', fontSize: 11, fontFamily: 'Iceland_400Regular' },
  makerText: { color: '#555', fontSize: 11, fontFamily: 'Iceland_400Regular' },
  methodsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, gap: 4 },
  methodTag: { borderRadius: 4, backgroundColor: '#1a1a1a', color: '#777', fontSize: 10, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#333' },

  emptyText: { color: '#555', textAlign: 'center', marginTop: 60, fontFamily: 'Iceland_400Regular' },
  postBtn: { position: 'absolute', bottom: 90, alignSelf: 'center', backgroundColor: '#22c55e', borderRadius: 24, paddingHorizontal: 28, paddingVertical: 14 },
  postBtnText: { color: '#000', fontWeight: '700', fontSize: 15, fontFamily: 'Iceland_400Regular' },
});
