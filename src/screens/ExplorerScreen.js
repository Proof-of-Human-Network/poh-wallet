import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, ActivityIndicator, ScrollView,
} from 'react-native';

const POH = 1_000_000_000;

function fmtPOH(v) { return ((v || 0) / POH).toLocaleString(undefined, { maximumFractionDigits: 4 }); }
function fmtTime(ts) { return ts ? new Date(ts).toLocaleString() : '—'; }
function fmtAddr(a) { return a ? a.slice(0, 10) + '…' + a.slice(-6) : '—'; }

export default function ExplorerScreen({ activeNodeUrl, onNavigate }) {
  const [query, setQuery]         = useState('');
  const [result, setResult]       = useState(null);
  const [blocks, setBlocks]       = useState([]);
  const [page, setPage]           = useState(0);
  const [totalBlocks, setTotal]   = useState(0);
  const [loading, setLoading]     = useState(false);
  const [tab, setTab]             = useState('blocks'); // 'blocks' | 'result'

  const loadBlocks = useCallback(async (p = 0) => {
    if (!activeNodeUrl) return;
    setLoading(true);
    try {
      const res = await fetch(`${activeNodeUrl}/api/explorer/blocks?page=${p}&limit=20`);
      const data = await res.json();
      setBlocks(data.blocks || []);
      setTotal(data.total || 0);
      setPage(p);
    } catch { /* keep stale */ }
    setLoading(false);
  }, [activeNodeUrl]);

  useEffect(() => { loadBlocks(0); }, [loadBlocks]);

  const search = async () => {
    if (!query.trim() || !activeNodeUrl) return;
    setLoading(true);
    setTab('result');
    try {
      const res = await fetch(`${activeNodeUrl}/api/explorer/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setResult(data);
    } catch (e) { setResult({ type: 'error', message: e.message }); }
    setLoading(false);
  };

  const viewBlock = async (height) => {
    if (!activeNodeUrl) return;
    setLoading(true);
    setTab('result');
    try {
      const res = await fetch(`${activeNodeUrl}/api/explorer/block/${height}`);
      const data = await res.json();
      setResult({ type: 'block', block: data });
    } catch (e) { setResult({ type: 'error', message: e.message }); }
    setLoading(false);
  };

  const searchAddr = (addr) => {
    setQuery(addr);
    setTab('result');
    setLoading(true);
    fetch(`${activeNodeUrl}/api/explorer/search?q=${encodeURIComponent(addr)}`)
      .then(r => r.json())
      .then(d => { setResult(d); setLoading(false); })
      .catch(e => { setResult({ type: 'error', message: e.message }); setLoading(false); });
  };

  const renderResult = () => {
    if (!result) return <Text style={styles.empty}>No results</Text>;
    if (result.type === 'error') return <Text style={styles.error}>{result.message}</Text>;

    if (result.type === 'block') {
      const b = result.block;
      const txs = b.transactions || [];
      return (
        <ScrollView>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>BLOCK #{b.height}</Text>
            <Row label="HASH" value={b.hash} small />
            <Row label="MINER" value={b.minerWallet} onPress={() => searchAddr(b.minerWallet)} />
            <Row label="TIME" value={fmtTime(b.timestamp)} />
            <Row label="REWARD" value={b.coinbaseReward > 0 ? fmtPOH(b.coinbaseReward) + ' POH' : '—'} green />
            <Row label="TXS" value={String(txs.length)} />
          </View>
          {txs.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>TRANSACTIONS</Text>
              {txs.map((tx, i) => (
                <View key={i} style={styles.txCard}>
                  <Text style={styles.txHash}>{tx.hash || tx.txHash || '—'}</Text>
                  <View style={styles.txRow}>
                    <TouchableOpacity onPress={() => searchAddr(tx.from)}>
                      <Text style={styles.txAddr}>{fmtAddr(tx.from)}</Text>
                    </TouchableOpacity>
                    <Text style={styles.txAmount}>{fmtPOH(tx.amount)} POH</Text>
                    <TouchableOpacity onPress={() => searchAddr(tx.to)}>
                      <Text style={styles.txAddr}>{fmtAddr(tx.to)}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      );
    }

    if (result.type === 'tx') {
      const { tx, block } = result;
      return (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>TRANSACTION</Text>
          <Text style={styles.txHash}>{tx.hash || tx.txHash || '—'}</Text>
          <Row label="BLOCK" value={`#${block.height}`} onPress={() => viewBlock(block.height)} green />
          <Row label="FROM" value={tx.from} onPress={() => searchAddr(tx.from)} />
          <Row label="TO" value={tx.to} onPress={() => searchAddr(tx.to)} />
          <Row label="AMOUNT" value={fmtPOH(tx.amount) + ' POH'} green />
          <Row label="TIME" value={fmtTime(block.timestamp)} />
        </View>
      );
    }

    if (result.type === 'address') {
      return (
        <ScrollView>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>ADDRESS</Text>
            <Text style={styles.txHash}>{result.address}</Text>
            <Row label="BALANCE" value={fmtPOH(result.balance) + ' POH'} green />
          </View>
          {result.entries?.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>RECENT TRANSACTIONS</Text>
              {result.entries.map((e, i) => (
                <View key={i} style={styles.histRow}>
                  <Text style={styles.histLabel}>{e.label} · Block #{e.height || '?'}</Text>
                  <Text style={[styles.histAmt, { color: e.delta > 0 ? '#22c55e' : '#ef4444' }]}>
                    {e.delta > 0 ? '+' : ''}{fmtPOH(e.delta)} POH
                  </Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      );
    }

    return <Text style={styles.empty}>No results for "{query}"</Text>;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => onNavigate('home')}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Blockchain Explorer</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Address, tx hash, or block height…"
          placeholderTextColor="#444"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={styles.searchBtn} onPress={search}>
          <Text style={styles.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'blocks' && styles.tabActive]}
          onPress={() => setTab('blocks')}
        >
          <Text style={[styles.tabText, tab === 'blocks' && styles.tabTextActive]}>BLOCKS</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'result' && styles.tabActive]}
          onPress={() => setTab('result')}
        >
          <Text style={[styles.tabText, tab === 'result' && styles.tabTextActive]}>RESULT</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator color="#22c55e" style={{ marginTop: 20 }} />}

      {!loading && tab === 'blocks' && (
        <>
          <FlatList
            data={blocks}
            keyExtractor={b => String(b.height)}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 100 }}
            renderItem={({ item: b }) => (
              <TouchableOpacity style={styles.blockCard} onPress={() => viewBlock(b.height)}>
                <View>
                  <Text style={styles.blockHeight}>#{b.height}</Text>
                  <Text style={styles.blockMeta}>{fmtAddr(b.miner)} · {b.txCount} tx</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {b.reward > 0 && <Text style={styles.reward}>+{fmtPOH(b.reward)} POH</Text>}
                  <Text style={styles.blockTime}>{b.timestamp ? new Date(b.timestamp).toLocaleTimeString() : ''}</Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No blocks yet</Text>}
          />
          <View style={styles.pageRow}>
            <TouchableOpacity
              style={[styles.pageBtn, page === 0 && styles.pageBtnDisabled]}
              onPress={() => page > 0 && loadBlocks(page - 1)}
              disabled={page === 0}
            >
              <Text style={styles.pageBtnText}>← Newer</Text>
            </TouchableOpacity>
            <Text style={styles.pageNum}>Page {page + 1}</Text>
            <TouchableOpacity style={styles.pageBtn} onPress={() => loadBlocks(page + 1)}>
              <Text style={styles.pageBtnText}>Older →</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {!loading && tab === 'result' && (
        <View style={{ flex: 1, paddingHorizontal: 4 }}>
          {renderResult()}
        </View>
      )}
    </View>
  );
}

function Row({ label, value, small, green, onPress }) {
  const valueStyle = [styles.rowValue, green && { color: '#22c55e' }, small && { fontSize: 10 }];
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {onPress ? (
        <TouchableOpacity onPress={onPress}>
          <Text style={[...valueStyle, { color: '#60a5fa', textDecorationLine: 'underline' }]}>{value}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={valueStyle}>{value}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  back: { color: '#22c55e', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  title: { color: '#fff', fontSize: 17, fontFamily: 'Iceland_400Regular' },

  searchRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  searchInput: { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 8, color: '#fff', padding: 10, fontSize: 12, fontFamily: 'Iceland_400Regular' },
  searchBtn: { backgroundColor: '#22c55e', borderRadius: 8, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  searchBtnText: { color: '#000', fontWeight: '700', fontSize: 13, fontFamily: 'Iceland_400Regular' },

  tabs: { flexDirection: 'row', borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: '#1e1e1e', marginBottom: 8 },
  tab: { flex: 1, padding: 7, alignItems: 'center', backgroundColor: '#111' },
  tabActive: { backgroundColor: '#166534' },
  tabText: { color: '#555', fontSize: 11, fontFamily: 'Iceland_400Regular' },
  tabTextActive: { color: '#22c55e', fontWeight: '600' },

  blockCard: { backgroundColor: '#0a0a0a', borderRadius: 6, padding: 10, marginBottom: 5, borderWidth: 1, borderColor: '#1a1a1a', flexDirection: 'row', justifyContent: 'space-between' },
  blockHeight: { color: '#22c55e', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  blockMeta: { color: '#555', fontSize: 11, fontFamily: 'Iceland_400Regular', marginTop: 2 },
  blockTime: { color: '#374151', fontSize: 10, fontFamily: 'Iceland_400Regular' },
  reward: { color: '#22c55e', fontSize: 11, fontFamily: 'Iceland_400Regular' },

  pageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  pageBtn: { borderWidth: 1, borderColor: '#333', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5 },
  pageBtnDisabled: { opacity: 0.3 },
  pageBtnText: { color: '#888', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  pageNum: { color: '#555', fontSize: 12, fontFamily: 'Iceland_400Regular' },

  card: { backgroundColor: '#0d0d0d', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1a1a1a' },
  cardLabel: { color: '#555', fontSize: 11, fontFamily: 'Iceland_400Regular', letterSpacing: 1, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  rowLabel: { color: '#555', fontSize: 11, fontFamily: 'Iceland_400Regular' },
  rowValue: { color: '#aaa', fontSize: 11, fontFamily: 'Iceland_400Regular', maxWidth: '65%', textAlign: 'right' },

  txCard: { backgroundColor: '#0a0a0a', borderRadius: 6, padding: 8, marginBottom: 5, borderWidth: 1, borderColor: '#1a1a1a' },
  txHash: { color: '#60a5fa', fontSize: 10, fontFamily: 'Iceland_400Regular', marginBottom: 4 },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  txAddr: { color: '#555', fontSize: 10, fontFamily: 'Iceland_400Regular' },
  txAmount: { color: '#22c55e', fontSize: 11, fontFamily: 'Iceland_400Regular' },

  sectionLabel: { color: '#555', fontSize: 11, fontFamily: 'Iceland_400Regular', letterSpacing: 1, marginBottom: 5, marginTop: 6 },
  histRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#111' },
  histLabel: { color: '#555', fontSize: 11, fontFamily: 'Iceland_400Regular' },
  histAmt: { fontSize: 12, fontFamily: 'Iceland_400Regular' },

  empty: { color: '#555', textAlign: 'center', marginTop: 40, fontFamily: 'Iceland_400Regular' },
  error: { color: '#ef4444', textAlign: 'center', marginTop: 40, fontFamily: 'Iceland_400Regular' },
});
