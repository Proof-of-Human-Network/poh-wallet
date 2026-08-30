import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { PairSession, describeRequest, isSecureEnough, parsePairingUri } from '../services/pairing';
import { getPrivateKey } from '../services/storage';

/**
 * Pair with aist.exchange and approve what it asks to sign.
 *
 * This device holds the key; the browser holds nothing. Every request is shown
 * in human terms and nothing is ever signed without an explicit tap.
 */
export default function PairScreen({ wallets = [], selectedAddress, nodeUrl, t }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraVisible, setCameraVisible] = useState(false);
  const [scanned, setScanned] = useState(false);

  const [pendingUri, setPendingUri] = useState(null);     // scanned, awaiting address choice
  const [sessions, setSessions] = useState([]);           // live PairSession objects
  const [request, setRequest] = useState(null);           // { session, req } awaiting approval
  const [busy, setBusy] = useState(false);
  const [secure, setSecure] = useState(true);
  const [error, setError] = useState(null);

  const sessionsRef = useRef([]);
  sessionsRef.current = sessions;
  const queueRef = useRef([]);

  useEffect(() => { isSecureEnough().then(setSecure); }, []);

  // Poll every live session. One loop for all of them, restarted when the set
  // changes. Requests are queued so two sessions cannot race the same prompt.
  useEffect(() => {
    let stop = false;
    const controller = new AbortController();

    async function loop() {
      while (!stop) {
        const live = sessionsRef.current.filter((s) => s.live);
        if (!live.length) { await sleep(700); continue; }
        await Promise.all(live.map(async (s) => {
          try {
            const reqs = await s.poll(controller.signal);
            for (const req of reqs) {
              // Refuse anything outside the allowlist without troubling the user.
              const refusal = s.reasonToRefuse(req);
              if (refusal) { await s.reject(req, refusal); continue; }
              queueRef.current.push({ session: s, req });
            }
          } catch { /* transient; the next tick retries */ }
        }));
        setSessions((prev) => [...prev]);          // refresh expiry labels
        if (!request && queueRef.current.length) setRequest(queueRef.current.shift());
        await sleep(200);
      }
    }
    loop();
    return () => { stop = true; controller.abort(); };
  }, [request]);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function openScanner() {
    setError(null);
    if (!secure) {
      Alert.alert(
        'Not available on this device',
        'Pairing signs on behalf of a wallet, so the key has to sit in the secure '
        + 'keystore. This platform stores it in ordinary app storage instead.',
      );
      return;
    }
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) { setError('Camera permission is needed to scan the code.'); return; }
    }
    setScanned(false);
    setCameraVisible(true);
  }

  const onBarcodeScanned = useCallback(({ data }) => {
    if (scanned) return;
    setScanned(true);
    setCameraVisible(false);
    try {
      parsePairingUri(data);            // validate before asking anything of the user
      setPendingUri(data);
    } catch (e) {
      setError(pairError(e.message));
    }
  }, [scanned]);

  /** The user picks which address this session may sign for. */
  async function bindSession(address) {
    setBusy(true);
    setError(null);
    try {
      const privHex = await getPrivateKey(address);
      if (!privHex) throw new Error('no-key');
      const session = new PairSession({
        uri: pendingUri, address, privateKeyHex: privHex, label: 'phone',
      });
      await session.registerKey(nodeUrl);
      await session.hello();
      setSessions((prev) => [...prev, session]);
      setPendingUri(null);
    } catch (e) {
      setError(e.message === 'no-key'
        ? 'That wallet has no key on this device.'
        : `Could not pair: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function decide(approve) {
    if (!request) return;
    setBusy(true);
    try {
      if (approve) await request.session.approve(request.req);
      else await request.session.reject(request.req, 'declined');
    } catch (e) {
      setError(`Could not answer: ${e.message}`);
    } finally {
      setBusy(false);
      setRequest(queueRef.current.shift() || null);
    }
  }

  async function revoke(session) {
    await session.revoke();
    // Anything already queued for a revoked session must never be shown.
    queueRef.current = queueRef.current.filter((q) => q.session !== session);
    if (request && request.session === session) setRequest(queueRef.current.shift() || null);
    setSessions((prev) => prev.filter((s) => s !== session));
  }

  const desc = request ? describeRequest(request.req, request.session.address) : null;

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <Text style={styles.lede}>
          Scan the code shown by aist.exchange. Your key stays on this phone — the
          site only ever receives signatures you approve here.
        </Text>

        {!secure && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              This platform has no secure keystore, so pairing is disabled here.
            </Text>
          </View>
        )}

        <TouchableOpacity style={styles.primary} onPress={openScanner} disabled={!secure}>
          <Text style={styles.primaryText}>Scan pairing code</Text>
        </TouchableOpacity>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.section}>Active sessions</Text>
        {sessions.length === 0 && <Text style={styles.muted}>No site is paired.</Text>}
        {sessions.map((s) => {
          const info = s.summary();
          const mins = Math.max(0, Math.round((info.expiresAt - Date.now()) / 60000));
          return (
            <View key={info.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{hostOf(info.relay)}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{info.address}</Text>
                <Text style={styles.rowMeta}>
                  {info.expired ? 'expired' : `${mins} min left`}
                </Text>
              </View>
              <TouchableOpacity style={styles.revoke} onPress={() => revoke(s)}>
                <Text style={styles.revokeText}>Revoke</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {/* camera */}
      <Modal visible={cameraVisible} animationType="slide" onRequestClose={() => setCameraVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onBarcodeScanned}
          />
          <TouchableOpacity style={styles.camClose} onPress={() => setCameraVisible(false)}>
            <Text style={styles.primaryText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* which address may this session sign for */}
      <Modal visible={!!pendingUri} transparent animationType="fade" onRequestClose={() => setPendingUri(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Sign as which wallet?</Text>
            <Text style={styles.muted}>
              This session will be able to request signatures for the wallet you pick,
              and no other.
            </Text>
            <ScrollView style={{ maxHeight: 280, marginTop: 10 }}>
              {wallets.map((w) => {
                const addr = typeof w === 'string' ? w : w.address;
                return (
                  <TouchableOpacity
                    key={addr}
                    style={[styles.walletRow, addr === selectedAddress && styles.walletRowOn]}
                    onPress={() => bindSession(addr)}
                    disabled={busy}
                  >
                    <Text style={styles.rowSub} numberOfLines={1}>{addr}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.ghost} onPress={() => setPendingUri(null)}>
              <Text style={styles.ghostText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* approval */}
      <Modal visible={!!request} transparent animationType="fade" onRequestClose={() => decide(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            {desc && (
              <>
                <Text style={styles.sheetTitle}>{desc.title}</Text>
                {desc.detail ? <Text style={styles.detail}>{desc.detail}</Text> : null}
                {desc.warning ? <Text style={styles.warnText}>{desc.warning}</Text> : null}
                <View style={styles.table}>
                  {desc.rows.map(([k, v]) => (
                    <View key={k} style={styles.tableRow}>
                      <Text style={styles.tableKey}>{k}</Text>
                      <Text style={styles.tableVal} numberOfLines={1}>{v}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.muted}>
                  Requested by {hostOf(request.session.relay)}
                </Text>
              </>
            )}
            {busy ? <ActivityIndicator color="#22c55e" style={{ marginTop: 14 }} /> : (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <TouchableOpacity style={[styles.ghost, { flex: 1 }]} onPress={() => decide(false)}>
                  <Text style={styles.ghostText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primary, { flex: 1, marginTop: 0 }]} onPress={() => decide(true)}>
                  <Text style={styles.primaryText}>Approve</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function hostOf(url) {
  try { return String(url).replace(/^https?:\/\//, '').split('/')[0]; } catch { return url; }
}

function pairError(code) {
  switch (code) {
    case 'not-a-pairing-code': return 'That QR is not an AIST pairing code.';
    case 'unsupported-version': return 'This pairing code needs a newer app version.';
    case 'bad-topic': case 'bad-key': case 'bad-relay': return 'That pairing code is malformed.';
    default: return `Could not read that code (${code}).`;
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 10 },
  lede: { color: '#9ca3af', fontSize: 14, lineHeight: 20, marginBottom: 14, fontFamily: 'Iceland_400Regular' },
  primary: { backgroundColor: '#22c55e', paddingVertical: 13, borderRadius: 4, alignItems: 'center', marginTop: 6 },
  primaryText: { color: '#000', fontWeight: '700', fontSize: 15, fontFamily: 'Iceland_400Regular' },
  ghost: { borderWidth: 1, borderColor: '#374151', paddingVertical: 13, borderRadius: 4, alignItems: 'center', marginTop: 10 },
  ghostText: { color: '#9ca3af', fontSize: 15, fontFamily: 'Iceland_400Regular' },
  section: { color: '#fff', fontSize: 16, marginTop: 24, marginBottom: 8, fontFamily: 'Iceland_400Regular' },
  muted: { color: '#4b5563', fontSize: 13, lineHeight: 19, fontFamily: 'Iceland_400Regular' },
  error: { color: '#ef4444', fontSize: 13, marginTop: 10, fontFamily: 'Iceland_400Regular' },
  warnBox: { borderWidth: 1, borderColor: '#b45309', backgroundColor: '#1c1917', borderRadius: 4, padding: 10, marginBottom: 10 },
  warnText: { color: '#f59e0b', fontSize: 13, lineHeight: 19, marginTop: 6, fontFamily: 'Iceland_400Regular' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 4, padding: 10, marginBottom: 8 },
  rowTitle: { color: '#fff', fontSize: 15, fontFamily: 'Iceland_400Regular' },
  rowSub: { color: '#9ca3af', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  rowMeta: { color: '#22c55e', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  revoke: { borderWidth: 1, borderColor: '#ef4444', borderRadius: 4, paddingVertical: 7, paddingHorizontal: 12 },
  revokeText: { color: '#ef4444', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#1f2937', borderRadius: 6, padding: 16 },
  sheetTitle: { color: '#fff', fontSize: 19, marginBottom: 8, fontFamily: 'Iceland_400Regular' },
  detail: { color: '#d1d5db', fontSize: 14, lineHeight: 20, marginBottom: 6, fontFamily: 'Iceland_400Regular' },
  table: { borderTopWidth: 1, borderTopColor: '#1f2937', marginTop: 12, paddingTop: 10, marginBottom: 10 },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
  tableKey: { color: '#4b5563', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  tableVal: { color: '#fff', fontSize: 13, flexShrink: 1, textAlign: 'right', fontFamily: 'Iceland_400Regular' },
  walletRow: { borderWidth: 1, borderColor: '#1f2937', borderRadius: 4, padding: 11, marginBottom: 6 },
  walletRowOn: { borderColor: '#22c55e' },
  camClose: { backgroundColor: '#22c55e', margin: 16, paddingVertical: 13, borderRadius: 4, alignItems: 'center' },
});
