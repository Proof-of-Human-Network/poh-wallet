import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Clipboard,
} from 'react-native';
import { fetchReferralStats, applyReferralCode } from '../services/p2pClient';

function formatPOH(uPOH) {
  return (uPOH / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function ReferralScreen({ selectedAddress, activeNodeUrl, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [referCode, setReferCode] = useState('');
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    if (!activeNodeUrl || !selectedAddress) return;
    setLoading(true);
    try {
      const data = await fetchReferralStats(activeNodeUrl, selectedAddress);
      if (!data.error) setStats(data);
    } catch { /* keep stale */ }
    setLoading(false);
  }, [activeNodeUrl, selectedAddress]);

  useEffect(() => { load(); }, [load]);

  const copyCode = () => {
    if (!stats?.code) return;
    Clipboard.setString(stats.code);
    Alert.alert('Copied', `Your referral code ${stats.code} has been copied.`);
  };

  const applyCode = async () => {
    if (!referCode.trim()) return Alert.alert('Enter a referral code');
    if (!selectedAddress) return Alert.alert('No wallet selected');
    setApplying(true);
    try {
      const result = await applyReferralCode(activeNodeUrl, selectedAddress, referCode.trim().toUpperCase());
      if (result.error) {
        Alert.alert('Error', result.error);
      } else {
        Alert.alert('Applied', `Referral code applied. You were referred by ${result.referrer.slice(0, 16)}…`);
        setReferCode('');
        load();
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => onNavigate('p2p')}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Referrals</Text>
        <View style={{ width: 50 }} />
      </View>

      {loading ? (
        <ActivityIndicator color="#22c55e" style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* My referral code */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>YOUR REFERRAL CODE</Text>
            <TouchableOpacity style={styles.codeRow} onPress={copyCode}>
              <Text style={styles.code}>{stats?.code || '—'}</Text>
              <Text style={styles.copyBtn}>Copy</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>Share this code with friends. You earn 0.3% of every trade they complete.</Text>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{stats?.referredCount ?? 0}</Text>
              <Text style={styles.statLabel}>Referred</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{stats?.tradeCount ?? 0}</Text>
              <Text style={styles.statLabel}>Trades</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{formatPOH(stats?.earnedFees ?? 0)}</Text>
              <Text style={styles.statLabel}>POH Earned</Text>
            </View>
          </View>

          {/* Apply referral code */}
          {!stats?.referredBy && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>ENTER REFERRAL CODE</Text>
              <Text style={styles.hint}>If someone referred you, enter their code below. One-time only.</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. A1B2C3D4"
                  placeholderTextColor="#444"
                  autoCapitalize="characters"
                  value={referCode}
                  onChangeText={setReferCode}
                />
                <TouchableOpacity style={styles.applyBtn} onPress={applyCode} disabled={applying}>
                  {applying ? <ActivityIndicator color="#000" size="small" /> : <Text style={styles.applyText}>Apply</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {stats?.referredBy && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>REFERRED BY</Text>
              <Text style={styles.referredBy}>{stats.referredBy}</Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16 },
  back: { color: '#22c55e', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  title: { color: '#fff', fontSize: 18, fontFamily: 'Iceland_400Regular' },
  card: { backgroundColor: '#0d0d0d', borderRadius: 12, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#1e1e1e' },
  cardLabel: { color: '#555', fontSize: 12, fontFamily: 'Iceland_400Regular', letterSpacing: 1, marginBottom: 10 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 8, padding: 12, marginBottom: 8 },
  code: { color: '#22c55e', fontSize: 22, fontFamily: 'Iceland_400Regular', letterSpacing: 4 },
  copyBtn: { color: '#22c55e', fontSize: 13, fontFamily: 'Iceland_400Regular', borderWidth: 1, borderColor: '#22c55e44', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  hint: { color: '#555', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statBox: { flex: 1, backgroundColor: '#0d0d0d', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1e1e1e' },
  statValue: { color: '#fff', fontSize: 20, fontFamily: 'Iceland_400Regular', marginBottom: 4 },
  statLabel: { color: '#555', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  input: { flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 8, color: '#fff', padding: 12, fontFamily: 'Iceland_400Regular', fontSize: 14 },
  applyBtn: { backgroundColor: '#22c55e', borderRadius: 8, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#000', fontWeight: '700', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  referredBy: { color: '#666', fontSize: 12, fontFamily: 'Iceland_400Regular', marginTop: 4 },
});
