import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, ActivityIndicator,
  ScrollView, FlatList, Alert, Linking, Image
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';

const BASE = 'https://proofofhuman.ge';
// const BASE = 'http://localhost:3456'; // for local dev against miner

export default function AIScreen({ t, wallets = [], selectedAddress, balances = {}, setSelectedAddress, saveSelectedAddress }) {
  // --- Connected wallet (uses app state) ---
  const connectedAddr = selectedAddress;
  const connectedBal = selectedAddress ? (balances[selectedAddress] || 0) : 0;

  // --- Scan state ---
  const [scanInput, setScanInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [checkerResults, setCheckerResults] = useState(null);
  const [brainVerdict, setBrainVerdict] = useState(null);
  const [brainPolling, setBrainPolling] = useState(false);
  const [resolveResults, setResolveResults] = useState([]);
  const [resolvedDisplay, setResolvedDisplay] = useState('');
  const [error, setError] = useState(null);
  const [ofacResult, setOfacResult] = useState(null);
  const [euResult, setEuResult] = useState(null);
  const [ukResult, setUkResult] = useState(null);
  const [scanProfile, setScanProfile] = useState(null);
  const [scanProfileLoading, setScanProfileLoading] = useState(false);
  const [vibeData, setVibeData] = useState(null);

  // Evidence accordions (like original)
  const [showEvidencePass, setShowEvidencePass] = useState(true);
  const [showEvidenceFail, setShowEvidenceFail] = useState(true);

  // --- Profile state (view-only for PoH addr) ---
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [rotatingKey, setRotatingKey] = useState(false);

  // --- Wallet switcher modal (simple picker) ---
  const [walletModalVisible, setWalletModalVisible] = useState(false);

  // --- Camera / QR scan modal ---
  const [cameraVisible, setCameraVisible] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  // Auto-load profile when connected changes
  useEffect(() => {
    if (connectedAddr) {
      loadProfile(connectedAddr);
    } else {
      setProfileData(null);
    }
  }, [connectedAddr]);

  // --- Helpers ---
  async function copyText(text) {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Text copied to clipboard');
  }

  async function pasteFromClipboard() {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) setScanInput(text.trim());
    } catch (e) {
      Alert.alert('Paste failed', e.message);
    }
  }

  // Open camera, request perm if needed
  async function openQRScanner() {
    if (!permission || !permission.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to scan QR codes for addresses.');
        return;
      }
    }
    setCameraVisible(true);
  }

  function onBarcodeScanned({ data }) {
    if (data) {
      setScanInput(data.trim());
      setCameraVisible(false);
    }
  }

  // Switch wallet from the local wallets list
  async function switchWallet(addr) {
    if (!addr || addr === connectedAddr) {
      setWalletModalVisible(false);
      return;
    }
    try {
      setSelectedAddress(addr);
      if (saveSelectedAddress) await saveSelectedAddress(addr);
    } catch (e) {}
    setWalletModalVisible(false);
    // profile will auto reload via useEffect
  }

  // Resolve name/handle to address (best effort)
  async function resolveToAddress(q) {
    if (!q) return q;
    const trimmed = q.trim();
    // quick heuristic: looks like address already
    if (trimmed.startsWith('poh') || trimmed.startsWith('0x') || trimmed.length > 30) {
      return trimmed;
    }
    try {
      const res = await fetch(`${BASE}/checker/resolve?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 1) {
        setResolveResults(data);
        setResolvedDisplay('');
        return trimmed; // let user pick
      }
      if (Array.isArray(data) && data.length === 1) {
        const hit = data[0];
        setResolvedDisplay(hit.address);
        return hit.address;
      }
      if (data && data.address) {
        setResolvedDisplay(data.address);
        return data.address;
      }
    } catch (e) {
      console.warn('resolve failed', e);
    }
    return trimmed;
  }

  // Poll brain verdict if we got a brainKey
  async function pollBrain(brainKey, addrForProfile) {
    if (!brainKey) return;
    setBrainPolling(true);
    setBrainVerdict(null);
    const maxTries = 40; // ~2 min
    let tries = 0;
    const iv = setInterval(async () => {
      tries++;
      try {
        const r = await fetch(`${BASE}/checker/brain/${encodeURIComponent(brainKey)}`);
        const b = await r.json();
        if (b && b.status === 'done') {
          setBrainVerdict(b);
          if (b.vibeData) setVibeData({ ...b.vibeData, farcasterData: b.farcasterData || null, paragraphData: b.paragraphData || null });
          setBrainPolling(false);
          clearInterval(iv);
          // load profile now that verdict is ready
          if (addrForProfile) loadScanProfile(addrForProfile);
        }
        if (tries > maxTries) {
          setBrainPolling(false);
          clearInterval(iv);
        }
      } catch {
        // keep polling
      }
    }, 3000);
    // safety cleanup
    setTimeout(() => {
      clearInterval(iv);
      setBrainPolling(false);
    }, 3 * 60 * 1000);
  }

  // Main scan action (mimics run-check in frontend)
  async function runCheck() {
    if ((!scanInput && resolveResults.length === 0) && !scanInput.trim()) return;
    setLoading(true);
    setError(null);
    setCheckerResults(null);
    setBrainVerdict(null);
    setBrainPolling(false);
    setResolvedDisplay('');
    setOfacResult(null);
    setEuResult(null);
    setUkResult(null);
    setScanProfile(null);
    setVibeData(null);
    // if we had resolve picker, use first or cleared
    let inputToUse = scanInput.trim();
    if (resolveResults.length > 0) {
      // if user didn't pick, use first
      inputToUse = resolveResults[0].address || inputToUse;
    }

    try {
      setIsResolving(true);
      const resolved = await resolveToAddress(inputToUse);
      setIsResolving(false);

      // Build form
      const form = new FormData();
      form.append('input', resolved);

      // Optionally send walletAddress for better limits / profile link (use connected if avail)
      if (connectedAddr) {
        form.append('walletAddress', connectedAddr);
      }

      const res = await fetch(`${BASE}/checker`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || 'Scan failed');
      }

      if (json.jobId) {
        // Batch/job style - poll job (simplified, show progress note)
        setCheckerResults(null);
        Alert.alert('Batch started', `Job ${json.jobId}. Polling for results (this demo shows first results when ready).`);
        // For simplicity in v1 we don't fully poll jobs here; user can re-run single
        setLoading(false);
        return;
      }

      // Direct result
      setCheckerResults(json.result || json.results || null);
      if (json.ofac) setOfacResult(json.ofac);
      if (json.eu) setEuResult(json.eu);
      if (json.uk) setUkResult(json.uk);
      if (json.verdict) {
        setBrainVerdict({
          status: 'done',
          verdict: json.verdict,
          confidence: json.confidence,
          reasoning: json.reasoning,
        });
      } else if (json.brainKey) {
        pollBrain(json.brainKey, resolved || inputToUse);
      }

      // Auto load full rich profile for the scanned addr (for full profile view with avatar, badges, graph)
      const scannedAddr = resolved || (json.result && json.result[0] && json.result[0].address) || inputToUse;
      if (scannedAddr) {
        loadScanProfile(scannedAddr);
      }
    } catch (e) {
      setError(e.message || 'Scan failed. Check network or try again.');
    } finally {
      setLoading(false);
      setResolveResults([]); // clear picker after use
    }
  }

  // Load rich scan profile (avatar, badges, crosschain, graph, identity etc from /checker/profile)
  async function loadScanProfile(addr) {
    if (!addr) return;
    setScanProfileLoading(true);
    try {
      const r = await fetch(`${BASE}/checker/profile/${encodeURIComponent(addr)}`);
      if (!r.ok) throw new Error('profile fetch failed');
      const data = await r.json();
      setScanProfile(data);
    } catch (e) {
      console.warn('[scan profile] load failed:', e.message);
    } finally {
      setScanProfileLoading(false);
    }
  }

  async function loadProfile(addr) {
    if (!addr) {
      setProfileData(null);
      return;
    }
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await fetch(`${BASE}/profile/${encodeURIComponent(addr)}`);
      if (res.status === 404) {
        setProfileData(null);
      } else {
        const data = await res.json();
        setProfileData(data);
      }
    } catch (e) {
      setProfileError(e.message || 'Failed to load profile');
    } finally {
      setProfileLoading(false);
    }
  }

  async function rotateApiKey() {
    if (!connectedAddr) return;
    setRotatingKey(true);
    try {
      const res = await fetch(`${BASE}/profile/apikey/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: connectedAddr }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Rotate failed');
      }
      await loadProfile(connectedAddr);
      Alert.alert('API Key Rotated', 'A new API key has been generated for this address.');
    } catch (e) {
      Alert.alert('Rotate Failed', e.message || 'Could not rotate the API key.');
    } finally {
      setRotatingKey(false);
    }
  }

  // Pick from resolve results
  function pickResolve(hit) {
    setScanInput(hit.address);
    setResolvedDisplay(hit.address);
    setResolveResults([]);
  }

  // --- Render helpers ---
  const passResults = (checkerResults || []).filter(r => r.result);
  const failResults = (checkerResults || []).filter(r => !r.result);

  // Helpers for full profile rendering (mimicking WalletProfile.vue)
  function fmt(addr) {
    if (!addr || addr.length < 10) return addr || '';
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }
  function getInitials(nameOrAddr) {
    if (!nameOrAddr) return '?';
    const parts = nameOrAddr.split(/[\s.@]/).filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    return nameOrAddr.slice(0, 2).toUpperCase();
  }
  function platformIcon(p) {
    const map = { twitter: '𝕏', farcaster: '🟣', lens: '🌿', github: '🐙', discord: '💬', telegram: '📨' };
    return map[p?.toLowerCase()] || '🔗';
  }
  function renderBadge(b, label, okColor = '#22c55e') {
    if (!b) return null;
    const isBad = b.sanctioned || b.result === false;
    return (
      <View style={[styles.badgeSmall, isBad ? styles.badgeDanger : { backgroundColor: '#052e16', borderColor: okColor }]}>
        <Text style={[styles.badgeSmallText, isBad ? {color:'#ef4444'} : {color: okColor}]}>
          {isBad ? '⛔ ' : '✓ '}{label}{b.name ? ' — ' + b.name : ''}
        </Text>
      </View>
    );
  }

  function renderFullProfile() {
    if (!scanProfile) return null;
    const p = scanProfile;
    const addr = p.address || resolvedDisplay || scanInput;
    const initials = getInitials(p.displayName || p.ens?.name || addr);
    const hasId = p.worldId != null || p.poh != null || p.brightid != null || p.bab != null || p.humanity != null || p.nomis != null || p.humanTech != null;
    return (
      <View style={styles.fullProfileRoot}>
        {/* Avatar + header */}
        <View style={styles.profileHeader}>
          <View style={styles.profileAvatarWrap}>
            {p.avatar ? (
              <Image source={{ uri: p.avatar }} style={styles.profileAvatar} />
            ) : (
              <View style={styles.profileAvatarFallback}><Text style={styles.avatarInitials}>{initials}</Text></View>
            )}
          </View>
          <View style={styles.profileHeaderInfo}>
            <Text style={styles.profileName}>{p.displayName || fmt(addr)}</Text>
            {p.displayName && <Text style={styles.profileAddrSub}>{fmt(addr)}</Text>}
            {p.bio && <Text style={styles.profileBio} numberOfLines={2}>{p.bio}</Text>}
          </View>
        </View>

        {/* Badges row: sanctions + social + AI verdict */}
        <View style={styles.profileBadges}>
          {renderBadge(ofacResult || p.ofac, 'OFAC')}
          {renderBadge(euResult || p.eu, 'EU')}
          {renderBadge(ukResult || p.uk, 'UK')}
          {p.ens && <View style={[styles.badgeSmall, styles.badgeOk]}><Text style={styles.badgeSmallText}>ENS: {p.ens.name || fmt(p.ens.address)}</Text></View>}
          {p.farcaster && <View style={[styles.badgeSmall, styles.badgeOk]}><Text style={styles.badgeSmallText}>🟣 {p.farcaster.handle || p.farcaster}</Text></View>}
          {p.worldId != null && <View style={[styles.badgeSmall, p.worldId ? styles.badgeOk : styles.badgeWarn]}><Text style={styles.badgeSmallText}>🌍 World ID</Text></View>}
          {p.poh != null && <View style={[styles.badgeSmall, p.poh ? styles.badgeOk : styles.badgeWarn]}><Text style={styles.badgeSmallText}>⚖️ PoH</Text></View>}
          {p.brightid != null && <View style={[styles.badgeSmall, p.brightid ? styles.badgeOk : styles.badgeWarn]}><Text style={styles.badgeSmallText}>🔆 BrightID</Text></View>}
          {p.bab != null && <View style={[styles.badgeSmall, p.bab ? styles.badgeOk : styles.badgeWarn]}><Text style={styles.badgeSmallText}>🏦 BAB KYC</Text></View>}
          {p.gitcoin && <View style={[styles.badgeSmall, p.gitcoin.passing ? styles.badgeOk : styles.badgeWarn]}><Text style={styles.badgeSmallText}>{p.gitcoin.passing ? '✓' : '⚠'} Gitcoin {p.gitcoin.score?.toFixed(1)}</Text></View>}
          {/* AI verdict badge */}
          <View style={[styles.badgeSmall, brainVerdict.verdict === 'HUMAN' ? styles.badgeHuman : brainVerdict.verdict === 'UNCERTAIN' ? styles.badgeWarn : styles.badgeDanger]}>
            <Text style={styles.badgeSmallText}>
              {brainVerdict.verdict === 'HUMAN' ? '✓ Verified Human' : brainVerdict.verdict === 'UNCERTAIN' ? '? Uncertain' : '✗ Suspected Bot'}
              <Text style={{fontSize:10}}> {Math.round((brainVerdict.confidence||0)*100)}%</Text>
            </Text>
          </View>
        </View>

        {/* Identity Protocols grid */}
        {hasId && (
          <View style={styles.idGrid}>
            {p.worldId != null && (
              <View style={[styles.idCard, p.worldId ? styles.idOk : styles.idNone]}>
                <Text style={styles.idIcon}>🌍</Text>
                <View style={styles.idBody}>
                  <Text style={styles.idName}>World ID</Text>
                  <Text style={styles.idStatus}>{p.worldId ? 'Verified human' : 'Not verified'}</Text>
                </View>
                {p.worldId && <Text style={styles.idCheck}>✓</Text>}
              </View>
            )}
            {p.poh != null && (
              <View style={[styles.idCard, p.poh ? styles.idOk : styles.idNone]}>
                <Text style={styles.idIcon}>⚖️</Text>
                <View style={styles.idBody}>
                  <Text style={styles.idName}>Proof of Humanity</Text>
                  <Text style={styles.idStatus}>{p.poh ? 'Registered' : 'Not registered'}</Text>
                </View>
                {p.poh && <Text style={styles.idCheck}>✓</Text>}
              </View>
            )}
            {p.brightid != null && (
              <View style={[styles.idCard, p.brightid ? styles.idOk : styles.idNone]}>
                <Text style={styles.idIcon}>🔆</Text>
                <View style={styles.idBody}>
                  <Text style={styles.idName}>BrightID</Text>
                  <Text style={styles.idStatus}>{p.brightid ? 'Verified unique' : 'Not verified'}</Text>
                </View>
                {p.brightid && <Text style={styles.idCheck}>✓</Text>}
              </View>
            )}
            {p.bab != null && (
              <View style={[styles.idCard, p.bab ? styles.idOk : styles.idNone]}>
                <Text style={styles.idIcon}>🏦</Text>
                <View style={styles.idBody}>
                  <Text style={styles.idName}>BAB Token</Text>
                  <Text style={styles.idStatus}>{p.bab ? 'Binance KYC' : 'No BAB token'}</Text>
                </View>
                {p.bab && <Text style={styles.idCheck}>✓</Text>}
              </View>
            )}
            {p.nomis && (
              <View style={[styles.idCard, p.nomis.score >= 50 ? styles.idOk : styles.idWarn]}>
                <Text style={styles.idIcon}>📊</Text>
                <View style={styles.idBody}>
                  <Text style={styles.idName}>Nomis</Text>
                  <Text style={styles.idStatus}>Score: {p.nomis.score?.toFixed(0) ?? '—'}</Text>
                </View>
                <View style={styles.scoreBar}><View style={[styles.scoreFill, {width: Math.min(100, p.nomis.score || 0) + '%'} ]} /></View>
              </View>
            )}
            {p.humanTech && (
              <View style={[styles.idCard, (p.humanTech.score || 0) >= 50 ? styles.idOk : styles.idWarn]}>
                <Text style={styles.idIcon}>🤖</Text>
                <View style={styles.idBody}>
                  <Text style={styles.idName}>Human Protocol</Text>
                  <Text style={styles.idStatus}>Score: {p.humanTech.score?.toFixed(0) ?? '—'}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Web3 domains */}
        {p.domains?.length > 0 && (
          <View style={styles.profileSection}>
            <Text style={styles.sectionSubTitle}>Web3 Domains</Text>
            <View style={styles.domainsRow}>
              {p.domains.slice(0,6).map((d,i) => (
                <TouchableOpacity key={i} onPress={() => { /* could set input and scan but for now just show */ }}>
                  <Text style={styles.domainChip}>{d.platform}: {d.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Social profiles */}
        {p.links?.length > 0 && (
          <View style={styles.profileSection}>
            <Text style={styles.sectionSubTitle}>Profiles</Text>
            <View style={styles.socialsRow}>
              {p.links.slice(0,8).map((l,i) => (
                <Text key={i} style={styles.socialChip}>{platformIcon(l.platform)} {l.displayName || l.identity}</Text>
              ))}
            </View>
          </View>
        )}

        {/* Cross chain balances summary */}
        {(p.eth || p.sol || p.crossChain || p.tron || p.ton || p.xlm) && (
          <View style={styles.profileSection}>
            <Text style={styles.sectionSubTitle}>Cross-Chain</Text>
            <View style={styles.ccGrid}>
              {p.eth && <Text style={styles.ccChip}>ETH: {p.eth.balance?.toFixed?.(2) ?? '—'}</Text>}
              {p.sol && <Text style={styles.ccChip}>SOL: {p.sol.balance?.toFixed?.(2) ?? '—'}</Text>}
              {p.crossChain && Object.keys(p.crossChain).slice(0,3).map(k => <Text key={k} style={styles.ccChip}>{k.toUpperCase()}</Text>)}
            </View>
          </View>
        )}

        {/* Tx Graph summary (simplified, no full d3 interactive) */}
        {p.graph?.nodes?.length > 1 && (
          <View style={styles.profileSection}>
            <Text style={styles.sectionSubTitle}>Tx Graph ({p.graph.nodes.length} nodes, {p.graph.edges?.length || 0} edges)</Text>
            <ScrollView horizontal style={styles.graphList}>
              {p.graph.nodes.slice(0, 8).map((n, i) => (
                <TouchableOpacity key={i} style={styles.graphNode} onPress={() => { setScanInput(n.id || n.address); /* user can re-scan */ }}>
                  <Text style={styles.graphNodeText}>{fmt(n.id || n.address || n)}</Text>
                </TouchableOpacity>
              ))}
              {p.graph.nodes.length > 8 && <Text style={{color:'#888'}}> +{p.graph.nodes.length-8} more</Text>}
            </ScrollView>
            <Text style={styles.graphHint}>Tap node to load in scanner</Text>
          </View>
        )}

        {/* Compact evidence from signals */}
        {checkerResults?.length > 0 && (
          <View style={styles.profileSection}>
            <Text style={styles.sectionSubTitle}>Evidence</Text>
            <View style={styles.evidenceDots}>
              {checkerResults.slice(0,12).map((r,i) => (
                <View key={i} style={[styles.evDot, r.result ? styles.evPass : styles.evFail]} />
              ))}
              <Text style={styles.evCount}>{checkerResults.filter(r=>r.result).length}/{checkerResults.length} passed</Text>
            </View>
          </View>
        )}

        {/* Social Characteristic — Farcaster + Paragraph */}
        {vibeData && (
          <View style={styles.charSection}>
            <Text style={styles.sectionSubTitle}>Social Characteristic</Text>

            {!!vibeData.vibe && <Text style={styles.charText}>{vibeData.vibe}</Text>}

            {vibeData.topics?.length > 0 && (
              <View style={styles.charTopics}>
                {vibeData.topics.map(t => <Text key={t} style={styles.charTopic}>{t}</Text>)}
              </View>
            )}

            {vibeData.humanSignals?.length > 0 && (
              <View style={{ marginBottom: 8 }}>
                {vibeData.humanSignals.map((s, i) => (
                  <Text key={i} style={styles.charSignal}>· {s}</Text>
                ))}
              </View>
            )}

            {vibeData.farcasterData && (
              <View style={styles.charSource}>
                <Text style={styles.charSourceLabel}>
                  🟣 Farcaster — @{vibeData.farcasterData.username}
                  {'  '}<Text style={styles.charFollowMeta}>{vibeData.farcasterData.followerCount?.toLocaleString()} followers</Text>
                </Text>
                {!!vibeData.farcasterData.bio && (
                  <Text style={styles.charBio}>"{vibeData.farcasterData.bio}"</Text>
                )}
                {(vibeData.farcasterData.casts || []).slice(0, 4).map((c, i) => (
                  <View key={i} style={styles.charCast}>
                    <Text style={styles.charCastText} numberOfLines={2}>{c.text}</Text>
                    {(c.likes > 0 || c.replies > 0) && (
                      <Text style={styles.charCastMeta}>{c.likes ? `♥${c.likes}` : ''}{c.replies ? ` ·${c.replies}r` : ''}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {vibeData.paragraphData && (
              <View style={styles.charSource}>
                <Text style={styles.charSourceLabel}>
                  ✍️ Paragraph — {vibeData.paragraphData.title}
                  {'  '}<Text style={styles.charFollowMeta}>{vibeData.paragraphData.subscriberCount?.toLocaleString()} subscribers</Text>
                </Text>
                {!!vibeData.paragraphData.description && (
                  <Text style={styles.charBio}>"{vibeData.paragraphData.description}"</Text>
                )}
                {(vibeData.paragraphData.posts || []).slice(0, 4).map((post, i) => (
                  <Text key={i} style={styles.charArticle}>
                    <Text style={styles.charArticleTitle}>{post.title}</Text>
                    {post.subtitle ? <Text style={styles.charArticleSub}> — {post.subtitle}</Text> : null}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* PROFILE (for connected wallet) */}
      <View style={styles.section}>
        {connectedAddr && (
          <TouchableOpacity style={[styles.smallBtn, { alignSelf: 'flex-start', marginBottom: 8 }]} onPress={() => loadProfile(connectedAddr)} disabled={profileLoading}>
            <Text style={styles.smallBtnText}>Refresh</Text>
          </TouchableOpacity>
        )}
        {!connectedAddr && <Text style={styles.muted}>Select a wallet to view its PoH profile.</Text>}

        {connectedAddr && (
          <>
            {profileError && <Text style={styles.errorText}>{profileError}</Text>}

            {profileData === null && !profileLoading && (
              <View style={styles.profileCard}>
                <Text style={styles.muted}>No profile found for this PoH address.</Text>
                <Text style={styles.hint}>You can still use the scanner with your PoH wallet (uses free quota). Create a profile here to get an API key for easier use.</Text>
                <TouchableOpacity style={styles.submitBtn} onPress={rotateApiKey} disabled={rotatingKey}>
                  <Text style={styles.submitText}>{rotatingKey ? 'Creating...' : 'Create Profile / Get API Key'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {profileData && (
              <View style={styles.profileCard}>
                <Text style={styles.profileStat}>Free scans left: {profileData.profile?.freeScansLeft ?? '—'}</Text>
                <Text style={styles.profileStat}>Total scans: {profileData.profile?.totalScans ?? 0}</Text>
                
                {/* Upgrade info like frontend profile (display only; full paid upgrade on web with Solana) */}
                <View style={{ marginTop: 8, padding: 8, backgroundColor: '#0f0f1a', borderRadius: 6, borderWidth: 1, borderColor: '#6366f1' }}>
                  <Text style={{ color: '#a5b4fc', fontSize: 12, fontWeight: '600' }}>
                    Current Plan: <Text style={{ fontWeight: 'bold', color: '#fff' }}>{profileData.profile?.plan || 'free'}</Text>
                    {profileData.profile?.plan === 'startup' && <Text style={{ color: '#22c55e', fontSize: 10 }}> (100k scans/mo)</Text>}
                  </Text>
                  {(!profileData.profile?.plan || profileData.profile.plan === 'free') && (
                    <Text style={styles.hint} onPress={() => Linking.openURL('https://proofofhuman.ge')}>
                      Startup &amp; Enterprise API keys are available at proofofhuman.ge (tap to open)
                    </Text>
                  )}
                </View>

                {profileData.profile?.apiKey && (
                  <View style={styles.apiKeyRow}>
                    <Text style={styles.apiKeyLabel}>API Key</Text>
                    <TouchableOpacity onPress={() => copyText(profileData.profile.apiKey)}>
                      <Text style={styles.apiKey} numberOfLines={1}>{profileData.profile.apiKey}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </View>

      {/* SCANNER */}
      <View style={styles.section}>
        <View style={styles.scanHero}>
          
          <Text style={styles.scanTitle}>AI Search</Text>
          <Text style={styles.scanSub}>Search by crypto wallet addresses, names and social profiles.</Text>
        </View>

        <View style={styles.scanBox}>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.scanInput}
              placeholder="0x… or poh… address, @handle, domain, or name"
              placeholderTextColor="#666"
              value={scanInput}
              onChangeText={setScanInput}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={runCheck}
            />
            <TouchableOpacity style={styles.iconBtn} onPress={pasteFromClipboard}>
              <Text style={styles.iconText}>⎘</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={openQRScanner}>
              <Text style={styles.iconText}>📷</Text>
            </TouchableOpacity>
          </View>

          {resolvedDisplay ? (
            <Text style={styles.resolved}>↳ {resolvedDisplay}</Text>
          ) : null}

          {resolveResults.length > 0 && (
            <View style={styles.resolvePicker}>
              <Text style={styles.resolveTitle}>Multiple matches — pick one:</Text>
              {resolveResults.map((hit, idx) => (
                <TouchableOpacity key={idx} style={styles.resolveHit} onPress={() => pickResolve(hit)}>
                  <Text style={styles.resolveName}>{hit.displayName || hit.handle || hit.address}</Text>
                  <Text style={styles.resolveSub}>{hit.address}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, (loading || (!scanInput && resolveResults.length === 0)) && styles.submitDisabled]}
            onPress={runCheck}
            disabled={loading || (!scanInput && resolveResults.length === 0)}
          >
            {loading || isResolving ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.submitText}>{isResolving ? 'Resolving…' : 'Scan'}</Text>
            )}
          </TouchableOpacity>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </View>

      {/* RESULTS */}
      {(checkerResults || brainVerdict || brainPolling) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Results</Text>

          {brainPolling && !brainVerdict && (
            <View style={[styles.brainCard, styles.brainPending]}>
              <Text style={styles.brainLabel}>AI Analysis</Text>
              <Text style={styles.brainText}>processing evidence…</Text>
            </View>
          )}

          {brainVerdict && brainVerdict.status !== 'not_found' && (
            <View style={[
              styles.brainCard,
              brainVerdict.verdict === 'HUMAN' ? styles.brainHuman :
              brainVerdict.verdict === 'UNCERTAIN' ? styles.brainUncertain : styles.brainBot
            ]}>
              <View style={styles.brainRow}>
                <Text style={styles.brainLabel}>AI Verdict</Text>
                <Text style={[
                  styles.badge,
                  brainVerdict.verdict === 'HUMAN' ? styles.badgeHuman :
                  brainVerdict.verdict === 'UNCERTAIN' ? styles.badgeUncertain : styles.badgeBot
                ]}>
                  {brainVerdict.verdict === 'HUMAN' ? 'VERIFIED HUMAN' : brainVerdict.verdict === 'UNCERTAIN' ? 'UNCERTAIN' : 'SUSPECTED BOT'}
                </Text>
              </View>
              <Text style={styles.brainReason}>{brainVerdict.reasoning}</Text>
              <Text style={styles.brainConf}>Confidence: {Math.round((brainVerdict.confidence || 0) * 100)}%</Text>
            </View>
          )}

          {/* Social Vibe */}
          {vibeData && brainVerdict && (
            <View style={styles.vibeCard}>
              <View style={styles.vibeHeader}>
                <Text style={styles.vibeLabel}>SOCIAL VIBE</Text>
                {vibeData.sources?.map(s => (
                  <Text key={s} style={styles.vibeSourcePill}>{s}</Text>
                ))}
              </View>
              {!!vibeData.vibe && <Text style={styles.vibeText}>{vibeData.vibe}</Text>}
              {vibeData.topics?.length > 0 && (
                <View style={styles.vibeTopics}>
                  {vibeData.topics.map(t => <Text key={t} style={styles.vibeTopic}>{t}</Text>)}
                </View>
              )}
              {vibeData.humanSignals?.length > 0 && vibeData.humanSignals.map((s, i) => (
                <Text key={i} style={styles.vibeSignal}>· {s}</Text>
              ))}
              {vibeData.farcasterData?.casts?.slice(0, 3).map((c, i) => (
                <View key={i} style={styles.vibeCast}>
                  <Text style={styles.vibeCastText} numberOfLines={2}>{c.text}</Text>
                  {(c.likes > 0 || c.replies > 0) && (
                    <Text style={styles.vibeCastMeta}>{c.likes ? `♥${c.likes}` : ''}{c.replies ? ` ·${c.replies}r` : ''}</Text>
                  )}
                </View>
              ))}
              {vibeData.paragraphData?.posts?.slice(0, 3).map((p, i) => (
                <Text key={i} style={styles.vibeArticle}>
                  <Text style={styles.vibeArticleTitle}>{p.title}</Text>
                  {p.subtitle ? <Text style={styles.vibeArticleSub}> — {p.subtitle}</Text> : null}
                </Text>
              ))}
            </View>
          )}

          {/* FULL PROFILE attached to AI verdict, like frontend WalletProfile with avatar, badges, identity, graph etc. */}
          {(scanProfileLoading || scanProfile) && brainVerdict && (
            <View style={styles.profileCardWrap}>
              {scanProfileLoading && (
                <View style={styles.profileLoading}>
                  <ActivityIndicator color="#22c55e" />
                  <Text style={styles.profileLoadingText}>Loading full profile…</Text>
                </View>
              )}
              {scanProfile && renderFullProfile()}
            </View>
          )}

          {checkerResults && (
            <View style={styles.resultsCard}>
              <Text style={styles.evidenceHeader}>
                Evidence • {passResults.length}/{checkerResults.length} passed
              </Text>

              {/* Pass */}
              <TouchableOpacity style={styles.accordionHeader} onPress={() => setShowEvidencePass(!showEvidencePass)}>
                <Text style={styles.accordionTitle}>✅ Pass ({passResults.length})</Text>
                <Text style={styles.chevron}>{showEvidencePass ? '−' : '+'}</Text>
              </TouchableOpacity>
              {showEvidencePass && (
                <View style={styles.resultsList}>
                  {passResults.length === 0 && <Text style={styles.empty}>No signals passed</Text>}
                  {passResults.map((res, i) => (
                    <View key={i} style={styles.resultRow}>
                      <Text style={styles.resultDotPass}>●</Text>
                      <Text style={styles.resultDesc}>{res.description}</Text>
                      <Text style={styles.badgePass}>PASS</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Fail */}
              <TouchableOpacity style={styles.accordionHeader} onPress={() => setShowEvidenceFail(!showEvidenceFail)}>
                <Text style={styles.accordionTitle}>❌ Fail ({failResults.length})</Text>
                <Text style={styles.chevron}>{showEvidenceFail ? '−' : '+'}</Text>
              </TouchableOpacity>
              {showEvidenceFail && (
                <View style={styles.resultsList}>
                  {failResults.length === 0 && <Text style={styles.empty}>No signals failed</Text>}
                  {failResults.map((res, i) => (
                    <View key={i} style={styles.resultRow}>
                      <Text style={styles.resultDotFail}>●</Text>
                      <Text style={styles.resultDesc}>{res.description}</Text>
                      <Text style={styles.badgeFail}>FAIL</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* Wallet Picker Modal */}
      <Modal visible={walletModalVisible} transparent animationType="fade" onRequestClose={() => setWalletModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Wallet</Text>
            {wallets.length === 0 && <Text style={styles.muted}>No wallets yet. Create one from the Wallets tab.</Text>}
            <FlatList
              data={wallets}
              keyExtractor={(item, idx) => item.address || String(idx)}
              renderItem={({ item }) => {
                const bal = balances[item.address] || 0;
                const isSel = item.address === connectedAddr;
                return (
                  <TouchableOpacity style={[styles.walletRow, isSel && styles.walletRowSel]} onPress={() => switchWallet(item.address)}>
                    <Text style={styles.walletRowAddr} numberOfLines={1}>{item.address}</Text>
                    <Text style={styles.walletRowBal}>{bal.toFixed(2)} POH</Text>
                  </TouchableOpacity>
                );
              }}
            />
            <TouchableOpacity style={styles.modalClose} onPress={() => setWalletModalVisible(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* QR Camera Modal */}
      <Modal visible={cameraVisible} transparent={false} animationType="slide" onRequestClose={() => setCameraVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {permission?.granted ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onBarcodeScanned}
            />
          ) : (
            <View style={styles.cameraPerm}>
              <Text style={{ color: '#fff' }}>Requesting camera permission...</Text>
            </View>
          )}
          <TouchableOpacity style={styles.cameraClose} onPress={() => setCameraVisible(false)}>
            <Text style={{ color: '#fff', fontSize: 18 }}>Close Scanner</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16, paddingBottom: 100 },

  section: { marginBottom: 20 },
  sectionTitle: { color: '#22c55e', fontSize: 16, fontWeight: '600', marginBottom: 8, fontFamily: 'Iceland_400Regular' },

  scanHero: { marginBottom: 8 },
  scanTag: { color: '#22c55e', fontSize: 11, letterSpacing: 2, marginBottom: 4 },
  scanTitle: { color: '#fff', fontSize: 22, fontWeight: '700', fontFamily: 'Iceland_400Regular' },
  scanSub: { color: '#888', fontSize: 13, marginTop: 4 },

  walletCard: { backgroundColor: '#111', borderRadius: 12, padding: 14, marginTop: 8 },
  walletAddr: { color: '#fff', fontSize: 15, fontFamily: 'monospace' },
  walletBal: { color: '#22c55e', fontSize: 18, fontWeight: '600', marginTop: 4 },

  scanBox: { backgroundColor: '#111', borderRadius: 12, padding: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#000', borderRadius: 8, paddingHorizontal: 10 },
  scanInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 12, fontFamily: 'monospace' },
  iconBtn: { padding: 8, marginLeft: 4 },
  iconText: { color: '#22c55e', fontSize: 18 },

  resolved: { color: '#888', fontSize: 12, marginTop: 6, marginLeft: 4 },
  resolvePicker: { marginTop: 10, backgroundColor: '#0a0a0a', borderRadius: 8, padding: 8 },
  resolveTitle: { color: '#888', fontSize: 12, marginBottom: 6 },
  resolveHit: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#222' },
  resolveName: { color: '#fff', fontSize: 14 },
  resolveSub: { color: '#666', fontSize: 11, fontFamily: 'monospace' },

  submitBtn: { backgroundColor: '#22c55e', marginTop: 14, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  submitDisabled: { backgroundColor: '#113d1f' },
  submitText: { color: '#000', fontWeight: '700', fontSize: 16, fontFamily: 'Iceland_400Regular' },
  smallBtn: { alignSelf: 'flex-start', backgroundColor: '#222', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginTop: 8 },
  smallBtnText: { color: '#22c55e', fontSize: 13 },

  resultsCard: { backgroundColor: '#111', borderRadius: 12, padding: 12, marginTop: 8 },
  evidenceHeader: { color: '#888', fontSize: 13, marginBottom: 8 },
  accordionHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#222' },
  accordionTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  chevron: { color: '#22c55e', fontSize: 18 },
  resultsList: { paddingLeft: 8, paddingBottom: 8 },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  resultDotPass: { color: '#22c55e', marginRight: 8 },
  resultDotFail: { color: '#ef4444', marginRight: 8 },
  resultDesc: { color: '#ddd', flex: 1, fontSize: 13 },
  badgePass: { color: '#22c55e', fontSize: 11, fontWeight: '700' },
  badgeFail: { color: '#ef4444', fontSize: 11, fontWeight: '700' },
  empty: { color: '#666', fontStyle: 'italic', paddingVertical: 4 },

  brainCard: { backgroundColor: '#111', borderRadius: 12, padding: 14, marginTop: 10 },
  brainPending: { borderColor: '#444', borderWidth: 1 },
  brainHuman: { borderColor: '#22c55e', borderWidth: 1 },
  brainUncertain: { borderColor: '#eab308', borderWidth: 1 },
  brainBot: { borderColor: '#ef4444', borderWidth: 1 },
  brainRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brainLabel: { color: '#888', fontSize: 13 },
  brainText: { color: '#aaa', marginTop: 6 },
  brainReason: { color: '#ddd', marginTop: 8, fontSize: 14 },
  brainConf: { color: '#888', marginTop: 6, fontSize: 12 },

  // Vibe card
  vibeCard: { backgroundColor: '#050d05', borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)', borderRadius: 12, padding: 14, marginTop: 10 },
  vibeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  vibeLabel: { fontFamily: 'Iceland_400Regular', fontSize: 9, letterSpacing: 1.5, color: '#22c55e' },
  vibeSourcePill: { fontFamily: 'Iceland_400Regular', fontSize: 9, color: '#374151', backgroundColor: '#111', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  vibeText: { fontFamily: 'Iceland_400Regular', fontSize: 13, color: '#9ca3af', lineHeight: 20, marginBottom: 10 },
  vibeTopics: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  vibeTopic: { fontFamily: 'Iceland_400Regular', fontSize: 10, color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  vibeSignal: { fontFamily: 'Iceland_400Regular', fontSize: 11, color: '#4b5563', lineHeight: 18 },
  vibeCast: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#0a0a0a' },
  vibeCastText: { flex: 1, fontFamily: 'Iceland_400Regular', fontSize: 11, color: '#6b7280', lineHeight: 15 },
  vibeCastMeta: { fontFamily: 'Iceland_400Regular', fontSize: 9, color: '#374151', marginLeft: 8 },
  vibeArticle: { paddingVertical: 3 },
  vibeArticleTitle: { fontFamily: 'Iceland_400Regular', fontSize: 11, color: '#9ca3af' },
  vibeArticleSub: { fontFamily: 'Iceland_400Regular', fontSize: 10, color: '#4b5563' },

  // Social characteristic (inside renderFullProfile)
  charSection: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  charText: { fontFamily: 'Iceland_400Regular', fontSize: 13, color: '#9ca3af', lineHeight: 20, marginBottom: 10 },
  charTopics: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  charTopic: { fontFamily: 'Iceland_400Regular', fontSize: 10, color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  charSignal: { fontFamily: 'Iceland_400Regular', fontSize: 11, color: '#4b5563', lineHeight: 18 },
  charSource: { marginTop: 10, padding: 10, backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#1a1a1a' },
  charSourceLabel: { fontFamily: 'Iceland_400Regular', fontSize: 11, color: '#6b7280', fontWeight: '600', marginBottom: 5, flexDirection: 'row', alignItems: 'center' },
  charFollowMeta: { fontFamily: 'Iceland_400Regular', fontSize: 10, color: '#374151' },
  charBio: { fontFamily: 'Iceland_400Regular', fontSize: 11, color: '#6b7280', fontStyle: 'italic', marginBottom: 6 },
  charCast: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#111' },
  charCastText: { flex: 1, fontFamily: 'Iceland_400Regular', fontSize: 11, color: '#6b7280', lineHeight: 15 },
  charCastMeta: { fontFamily: 'Iceland_400Regular', fontSize: 9, color: '#374151', marginLeft: 6 },
  charArticle: { paddingVertical: 3 },
  charArticleTitle: { fontFamily: 'Iceland_400Regular', fontSize: 11, color: '#9ca3af' },
  charArticleSub: { fontFamily: 'Iceland_400Regular', fontSize: 10, color: '#4b5563' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, fontSize: 11, fontWeight: '700' },
  badgeHuman: { backgroundColor: '#052e16', color: '#22c55e' },
  badgeUncertain: { backgroundColor: '#422006', color: '#eab308' },
  badgeBot: { backgroundColor: '#450a0a', color: '#ef4444' },

  profileCard: { backgroundColor: '#111', borderRadius: 12, padding: 14, marginTop: 8 },
  profileStat: { color: '#ddd', fontSize: 14, marginBottom: 4 },
  apiKeyRow: { marginTop: 10 },
  apiKeyLabel: { color: '#888', fontSize: 12 },
  apiKey: { color: '#22c55e', fontFamily: 'monospace', fontSize: 13 },
  bold: { fontWeight: '600', color: '#fff' },
  hint: { color: '#666', fontSize: 11, marginTop: 8 },

  profileCardTitle: { color: '#fff', fontWeight: '600', fontSize: 14 },
  profileCardCount: { color: '#22c55e', fontSize: 13 },
  miniBtn: { backgroundColor: '#222', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, marginLeft: 6 },
  miniBtnText: { color: '#22c55e', fontSize: 11 },

  mlistRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#222' },
  mlistMain: { flex: 1, marginRight: 8 },
  mlistType: { color: '#6366f1', fontSize: 11, fontWeight: '600' },
  mlistDesc: { color: '#ddd', fontSize: 13 },
  mlistMeta: { alignItems: 'flex-end' },
  mlistScore: { color: '#888', fontSize: 12 },

  muted: { color: '#888' },
  errorText: { color: '#ef4444', marginTop: 8 },

  // Full profile attached to verdict (WalletProfile-like)
  profileCardWrap: { marginTop: 12, backgroundColor: '#111', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#333' },
  profileLoading: { flexDirection: 'row', alignItems: 'center', padding: 8 },
  profileLoadingText: { color: '#888', marginLeft: 8, fontSize: 13 },
  fullProfileRoot: {},
  profileHeader: { flexDirection: 'row', marginBottom: 10 },
  profileAvatarWrap: { marginRight: 10 },
  profileAvatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: '#22c55e' },
  profileAvatarFallback: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: '#22c55e', fontSize: 18, fontWeight: '700' },
  profileHeaderInfo: { flex: 1, justifyContent: 'center' },
  profileName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  profileAddrSub: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
  profileBio: { color: '#aaa', fontSize: 12, marginTop: 2 },
  profileBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  badgeSmall: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#333' },
  badgeSmallText: { fontSize: 10, color: '#fff' },
  badgeOk: { backgroundColor: '#052e16', borderColor: '#22c55e' },
  badgeWarn: { backgroundColor: '#422006', borderColor: '#eab308' },
  badgeDanger: { backgroundColor: '#450a0a', borderColor: '#ef4444' },
  badgeHuman: { backgroundColor: '#052e16', borderColor: '#22c55e' },
  idGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  idCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 6, padding: 6, minWidth: 110, flex: 1 },
  idOk: { borderColor: '#22c55e', borderWidth: 1 },
  idNone: { borderColor: '#444', borderWidth: 1 },
  idWarn: { borderColor: '#eab308', borderWidth: 1 },
  idIcon: { fontSize: 14, marginRight: 4 },
  idBody: { flex: 1 },
  idName: { color: '#fff', fontSize: 11, fontWeight: '600' },
  idStatus: { color: '#888', fontSize: 9 },
  idCheck: { color: '#22c55e', fontSize: 12 },
  scoreBar: { height: 3, backgroundColor: '#333', marginTop: 2, borderRadius: 1 },
  scoreFill: { height: 3, backgroundColor: '#22c55e', borderRadius: 1 },
  profileSection: { marginTop: 6 },
  sectionSubTitle: { color: '#22c55e', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  domainsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  domainChip: { backgroundColor: '#1a1a1a', color: '#aaa', fontSize: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  socialsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  socialChip: { backgroundColor: '#1a1a1a', color: '#aaa', fontSize: 10, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  ccGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  ccChip: { backgroundColor: '#1a1a1a', color: '#aaa', fontSize: 10, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  graphList: { maxHeight: 32 },
  graphNode: { backgroundColor: '#222', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, marginRight: 4 },
  graphNodeText: { color: '#22c55e', fontSize: 10, fontFamily: 'monospace' },
  graphHint: { color: '#666', fontSize: 9, fontStyle: 'italic', marginTop: 2 },
  evidenceDots: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 3 },
  evDot: { width: 8, height: 8, borderRadius: 4 },
  evPass: { backgroundColor: '#22c55e' },
  evFail: { backgroundColor: '#ef4444' },
  evBlacklist: { backgroundColor: '#f59e0b' },
  evCount: { color: '#888', fontSize: 10, marginLeft: 6 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#111', borderRadius: 12, padding: 16, maxHeight: '70%' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  walletRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#222' },
  walletRowSel: { backgroundColor: '#052e16' },
  walletRowAddr: { color: '#fff', fontSize: 14, fontFamily: 'monospace' },
  walletRowBal: { color: '#22c55e', fontSize: 13 },
  modalClose: { marginTop: 12, alignItems: 'center', padding: 10 },
  modalCloseText: { color: '#888' },

  cameraPerm: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cameraClose: { position: 'absolute', bottom: 40, alignSelf: 'center', backgroundColor: '#222', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
});

