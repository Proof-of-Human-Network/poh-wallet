import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { fetchMyOrders, fetchMyTrades, cancelOrder } from '../services/p2pClient';

const POH_DECIMALS = 1_000_000_000;

function formatPOH(uPOH) {
  return (uPOH / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

const ORDER_STATUS_COLOR = { open: '#22c55e', locked: '#f59e0b', completed: '#6b7280', cancelled: '#4b5563', disputed: '#dc2626' };
const TRADE_STATUS_COLOR = { selected: '#f59e0b', payment_sent: '#3b82f6', completed: '#22c55e', cancelled: '#6b7280', disputed: '#dc2626' };

export default function MyOrdersScreen({ selectedAddress, activeNodeUrl, getPrivateKey, onNavigate }) {
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(null);

  const loadData = useCallback(async (silent = false) => {
    if (!selectedAddress || !activeNodeUrl) return;
    if (!silent) setLoading(true);
    try {
      const [ordRes, tradeRes] = await Promise.all([
        fetchMyOrders(activeNodeUrl, selectedAddress),
        fetchMyTrades(activeNodeUrl, selectedAddress),
      ]);
      setOrders(ordRes.orders || []);
      setTrades(tradeRes.trades || []);
    } catch { /* keep stale */ }
    setLoading(false);
    setRefreshing(false);
  }, [selectedAddress, activeNodeUrl]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = () => { setRefreshing(true); loadData(true); };

  const doCancel = async (order) => {
    Alert.alert('Cancel Order', `Cancel your ${order.side} order for ${formatPOH(order.pohAmount)} POH?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          setCancelling(order.id);
          try {
            const pk = await getPrivateKey(selectedAddress);
            if (!pk) return Alert.alert('Error', 'Private key not found.');
            const result = await cancelOrder(activeNodeUrl, { address: selectedAddress, privateKeyHex: pk, orderId: order.id });
            if (result.error) Alert.alert('Error', result.error);
            else await loadData(true);
          } catch (e) { Alert.alert('Error', e.message); }
          setCancelling(null);
        },
      },
    ]);
  };

  const renderOrder = ({ item: order }) => {
    const color = ORDER_STATUS_COLOR[order.status] || '#888';
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <Text style={[styles.badge, { backgroundColor: color + '22', color }]}>{order.status.toUpperCase()}</Text>
          <Text style={[styles.badge, order.side === 'sell' ? styles.sellBadge : styles.buyBadge]}>
            {order.side.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.cardTitle}>{formatPOH(order.pohAmount)} POH</Text>
        <Text style={styles.cardMeta}>
          {order.pricePerPOH} {order.quoteCurrency}/POH · Limit {order.minTrade}–{order.maxTrade?.toFixed(2)} {order.quoteCurrency}
        </Text>
        <Text style={styles.cardMeta}>{timeAgo(order.createdAt)}</Text>

        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.detailBtn} onPress={() => onNavigate('orderDetail', { orderId: order.id })}>
            <Text style={styles.detailBtnText}>View</Text>
          </TouchableOpacity>
          {order.status === 'open' && (
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => doCancel(order)}
              disabled={cancelling === order.id}
            >
              {cancelling === order.id
                ? <ActivityIndicator color="#dc2626" size="small" />
                : <Text style={styles.cancelBtnText}>Cancel</Text>}
            </TouchableOpacity>
          )}
          {order.status === 'locked' && order.tradeId && (
            <TouchableOpacity style={styles.detailBtn} onPress={() => onNavigate('trade', { tradeId: order.tradeId })}>
              <Text style={styles.detailBtnText}>View Trade</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderTrade = ({ item }) => {
    const { trade, order } = item;
    const isMaker = order?.maker === selectedAddress;
    const color = TRADE_STATUS_COLOR[trade.status] || '#888';
    return (
      <TouchableOpacity style={styles.card} onPress={() => onNavigate('trade', { tradeId: trade.id, orderId: trade.orderId })}>
        <View style={styles.cardRow}>
          <Text style={[styles.badge, { backgroundColor: color + '22', color }]}>{trade.status.replace('_', ' ').toUpperCase()}</Text>
          <Text style={styles.cardMeta}>{isMaker ? 'Maker' : 'Taker'}</Text>
        </View>
        <Text style={styles.cardTitle}>{formatPOH(trade.pohAmount)} POH</Text>
        <Text style={styles.cardMeta}>
          {trade.quoteAmount?.toFixed(4)} {order?.quoteCurrency} · {order?.side?.toUpperCase()} order
        </Text>
        {trade.paymentDeadline && trade.status === 'selected' && (
          <Text style={[styles.cardMeta, { color: '#f59e0b' }]}>
            Payment deadline: {new Date(trade.paymentDeadline).toLocaleTimeString()}
          </Text>
        )}
        <Text style={styles.cardMeta}>{timeAgo(trade.createdAt)}</Text>
      </TouchableOpacity>
    );
  };

  const activeOrders = orders.filter(o => ['open', 'locked', 'disputed'].includes(o.status));
  const pastOrders   = orders.filter(o => ['completed', 'cancelled'].includes(o.status));
  const activeTrades = trades.filter(t => !['completed', 'cancelled'].includes(t.trade?.status));
  const pastTrades   = trades.filter(t =>  ['completed', 'cancelled'].includes(t.trade?.status));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => onNavigate('p2p')}>
          <Text style={styles.back}>← P2P</Text>
        </TouchableOpacity>
        <Text style={styles.title}>My Activity</Text>
        <TouchableOpacity onPress={() => onNavigate('createOrder', {})}>
          <Text style={styles.newBtn}>+ New</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {['orders', 'trades'].map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>
              {t === 'orders' ? `Orders (${orders.length})` : `Trades (${trades.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && !refreshing ? (
        <ActivityIndicator color="#22c55e" style={{ marginTop: 40 }} />
      ) : tab === 'orders' ? (
        <FlatList
          data={[...activeOrders, ...pastOrders]}
          keyExtractor={o => o.id}
          renderItem={renderOrder}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />}
          ListEmptyComponent={<Text style={styles.emptyText}>No orders yet. Post one from the P2P screen.</Text>}
        />
      ) : (
        <FlatList
          data={[...activeTrades, ...pastTrades]}
          keyExtractor={item => item.trade?.id || Math.random().toString()}
          renderItem={renderTrade}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />}
          ListEmptyComponent={<Text style={styles.emptyText}>No trades yet. Select an order from the P2P screen.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  back: { color: '#22c55e', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  title: { color: '#fff', fontSize: 18, fontFamily: 'Iceland_400Regular' },
  newBtn: { color: '#22c55e', fontSize: 14, fontFamily: 'Iceland_400Regular' },

  tabRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#222' },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: '#111' },
  tabBtnActive: { backgroundColor: '#1a1a1a', borderBottomWidth: 2, borderBottomColor: '#22c55e' },
  tabBtnText: { color: '#888', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  tabBtnTextActive: { color: '#22c55e', fontWeight: '700' },

  card: { backgroundColor: '#111', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1e1e1e' },
  cardRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 16, fontFamily: 'Iceland_400Regular', marginBottom: 4 },
  cardMeta: { color: '#666', fontSize: 11, fontFamily: 'Iceland_400Regular', marginBottom: 2 },
  badge: { fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  sellBadge: { backgroundColor: '#7f1d1d22', color: '#fca5a5' },
  buyBadge: { backgroundColor: '#052e1622', color: '#86efac' },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  detailBtn: { borderRadius: 6, borderWidth: 1, borderColor: '#333', paddingHorizontal: 12, paddingVertical: 6 },
  detailBtnText: { color: '#aaa', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  cancelBtn: { borderRadius: 6, borderWidth: 1, borderColor: '#dc262633', paddingHorizontal: 12, paddingVertical: 6 },
  cancelBtnText: { color: '#dc2626', fontSize: 12, fontFamily: 'Iceland_400Regular' },

  emptyText: { color: '#555', textAlign: 'center', marginTop: 60, fontFamily: 'Iceland_400Regular' },
});
