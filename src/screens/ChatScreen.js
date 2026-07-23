import React, { useState, useRef, useEffect, useCallback } from 'react';
import { fetchChatSuggestions, fetchHistoryMatch } from '../services/nodeClient';
import { deriveSigningKeypair, signData, buildJobPaymentTx } from '../services/signing';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert, PanResponder,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

const MAX_ATTACH_BYTES = 100 * 1024;

// ── Log fee slider: 1 kPOH (=1000 μPOH, 1e-6 POH) → 1 POH, logarithmic ─────────
const LOG_MIN = 0.000001, LOG_MAX = 1, LOG_STEPS = 200;   // floor = 1 kPOH = 1000 μPOH
const _stepToPoh = s => s <= 0 ? LOG_MIN : LOG_MIN * Math.pow(LOG_MAX / LOG_MIN, (s - 1) / (LOG_STEPS - 1));
const _pohToStep = v => v <= LOG_MIN ? 1 : Math.round(1 + (LOG_STEPS - 1) * Math.log(v / LOG_MIN) / Math.log(LOG_MAX / LOG_MIN));
// Value at a fraction [0,1] of the log range — used by the preset marks.
const _pctToPoh = pct => LOG_MIN * Math.pow(LOG_MAX / LOG_MIN, pct);
// Preset marks: default 0% (= 1 kPOH = 1000 μPOH), low 25%, high 60%, max 100%.
const FEE_PRESETS = [
  { label: 'Default', pct: 0.00 },
  { label: 'Low',     pct: 0.25 },
  { label: 'High',    pct: 0.60 },
  { label: 'Max',     pct: 1.00 },
];
const _fmtPoh = p => {
  if (p <= 0) return '0';
  const k = p * 1e6;                     // kPOH — 1 kPOH = 1000 μPOH = 1e-6 POH
  if (k < 1000) return (k < 10 ? String(Math.round(k * 10) / 10) : Math.round(k).toLocaleString()) + ' kPOH';
  if (p < 1)    return p.toPrecision(2) + ' POH';
  return (p < 10 ? p.toFixed(2) : Math.round(p).toString()) + ' POH';
};

function LogSlider({ value, onChange, disabled }) {
  const step = _pohToStep(value);
  const fillPct = step <= 1 ? 0 : ((step - 1) / (LOG_STEPS - 1)) * 100;

  // Track geometry, kept in refs so the (once-created) PanResponder always reads
  // fresh values. We use absolute pageX minus the track's window offset instead of
  // nativeEvent.locationX: locationX is reported relative to whatever child view is
  // under the finger (the thumb dot / fill bar), so dragging over them collapses the
  // coordinate and the value teleports toward 0 — which looked like the fee snapping
  // onto the "Default"/preset marks.
  const trackRef = useRef(null);
  const trackWidthRef = useRef(1);
  const trackLeftRef = useRef(0);

  const measureTrack = () => {
    trackRef.current?.measureInWindow((x, _y, w) => {
      trackLeftRef.current = x;
      if (w) trackWidthRef.current = w;
    });
  };

  const stepFromPageX = (pageX) => {
    const x = pageX - trackLeftRef.current;
    const s = Math.round((x / (trackWidthRef.current || 1)) * (LOG_STEPS - 1)) + 1;
    return Math.max(1, Math.min(LOG_STEPS, s));
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder:  () => !disabled,
    onPanResponderGrant: (e) => { measureTrack(); onChange(_stepToPoh(stepFromPageX(e.nativeEvent.pageX))); },
    onPanResponderMove:  (e) => onChange(_stepToPoh(stepFromPageX(e.nativeEvent.pageX))),
  })).current;

  return (
    <View
      ref={trackRef}
      onLayout={measureTrack}
      {...panResponder.panHandlers}
      style={{ height: 36, justifyContent: 'center', paddingVertical: 10 }}
    >
      <View pointerEvents="none" style={{ height: 3, backgroundColor: '#2a2a2a', borderRadius: 2 }}>
        <View style={{ width: `${fillPct}%`, height: 3, backgroundColor: '#22c55e', borderRadius: 2 }} />
      </View>
      {step > 1 && (
        <View pointerEvents="none" style={{
          position: 'absolute', left: `${fillPct}%`, marginLeft: -7,
          top: 11, width: 14, height: 14, borderRadius: 7, backgroundColor: '#22c55e',
        }} />
      )}
    </View>
  );
}

// ── Markdown renderer ──────────────────────────────────────────────────────────
function parseInline(text) {
  if (!text.includes('**') && !text.includes('*') && !text.includes('`')) return text;
  const parts = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let last = 0, k = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Text key={k++}>{text.slice(last, m.index)}</Text>);
    const raw = m[0];
    if (raw.startsWith('**'))
      parts.push(<Text key={k++} style={{ fontWeight: '700', color: '#fff' }}>{raw.slice(2, -2)}</Text>);
    else if (raw.startsWith('*'))
      parts.push(<Text key={k++} style={{ fontStyle: 'italic', color: '#d1d5db' }}>{raw.slice(1, -1)}</Text>);
    else
      parts.push(<Text key={k++} style={s.inlineCode}>{raw.slice(1, -1)}</Text>);
    last = m.index + raw.length;
  }
  if (last < text.length) parts.push(<Text key={k++}>{text.slice(last)}</Text>);
  return parts;
}

function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split('\n');
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (line.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      elements.push(
        <View key={i} style={s.codeBlock}>
          <Text style={s.codeText}>{code.join('\n')}</Text>
        </View>
      );
    } else if ((m = line.match(/^### (.+)/))) {
      elements.push(<Text key={i} style={s.mdH3}>{m[1]}</Text>);
    } else if ((m = line.match(/^## (.+)/))) {
      elements.push(<Text key={i} style={s.mdH2}>{m[1]}</Text>);
    } else if ((m = line.match(/^# (.+)/))) {
      elements.push(<Text key={i} style={s.mdH1}>{m[1]}</Text>);
    } else if ((m = line.match(/^[-*] (.+)/))) {
      elements.push(<Text key={i} style={s.mdBullet}><Text>{'•  '}</Text>{parseInline(m[1])}</Text>);
    } else if ((m = line.match(/^(\d+)\. (.+)/))) {
      elements.push(<Text key={i} style={s.mdBullet}><Text>{m[1]+'.  '}</Text>{parseInline(m[2])}</Text>);
    } else if (line.match(/^---+$/)) {
      elements.push(<View key={i} style={s.mdRule} />);
    } else if (line.trim() === '') {
      if (i > 0 && lines[i - 1].trim() !== '') elements.push(<View key={i} style={{ height: 8 }} />);
    } else {
      elements.push(<Text key={i} style={s.resultText}>{parseInline(line)}</Text>);
    }
    i++;
  }
  return <>{elements}</>;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS  = 120_000;

// ── Main screen ───────────────────────────────────────────────────────────────
export default function ChatScreen({ activeNodeUrl, nodes = [], selectedAddress, balances, getPrivateKey }) {
  const [message,    setMessage]    = useState('');
  const [budget,     setBudget]     = useState(_pctToPoh(0)); // default preset = 1 kPOH (1000 μPOH)
  const [loading,    setLoading]    = useState(false);
  const [statusText, setStatusText] = useState('');
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState(null);
  const [attachedFile, setAttachedFile] = useState(null); // { name, content }
  const [suggestions, setSuggestions] = useState([]);
  const [historyBanner, setHistoryBanner] = useState(null);
  const suggestTimerRef = useRef(null);

  const balance = selectedAddress ? (balances?.[selectedAddress] ?? 0) : 0;

  const loadSuggestions = useCallback(async (q) => {
    if (!activeNodeUrl || q.length < 2) {
      setSuggestions([]);
      setHistoryBanner(null);
      return;
    }
    const data = await fetchChatSuggestions(activeNodeUrl, { q, wallet: selectedAddress });
    const list = data.suggestions || [];
    setSuggestions(list);
    const top = list[0];
    if (top?.replyPreview && top.prompt?.toLowerCase().includes(q.toLowerCase().slice(0, 6))) {
      setHistoryBanner(top);
    } else if (q.length < 6) {
      setHistoryBanner(null);
    }
  }, [activeNodeUrl, selectedAddress]);

  useEffect(() => {
    clearTimeout(suggestTimerRef.current);
    const q = message.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setHistoryBanner(null);
      return;
    }
    suggestTimerRef.current = setTimeout(() => loadSuggestions(q), 300);
    return () => clearTimeout(suggestTimerRef.current);
  }, [message, loadSuggestions]);

  const applySuggestion = (item) => {
    setMessage(item.prompt || '');
    setSuggestions([]);
    if (item.replyPreview) setHistoryBanner(item);
  };

  const useChainReply = async () => {
    const q = message.trim();
    if (!q || !activeNodeUrl) return;
    const match = await fetchHistoryMatch(activeNodeUrl, { q, wallet: selectedAddress });
    if (match?.reply) {
      setResult({ type: 'chat', message: match.reply, fromChainHistory: true });
      setHistoryBanner(null);
      setSuggestions([]);
    }
  };

  // ── File attachment ───────────────────────────────────────────────────────
  const pickAttachment = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      if (file.size && file.size > MAX_ATTACH_BYTES) {
        Alert.alert('File too large', `Max 100KB. "${file.name}" is ${(file.size / 1024).toFixed(0)}KB.`);
        return;
      }
      const content = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 });
      setAttachedFile({ name: file.name, content: content.slice(0, 100_000) });
    } catch (e) {
      Alert.alert('Error', 'Could not read that file. It may not be a text file.');
    }
  };

  const removeAttachment = () => setAttachedFile(null);

  // ── Node fetch ────────────────────────────────────────────────────────────
  async function askNode(q) {
    const candidates = [
      activeNodeUrl,
      ...nodes.map(n => n.url).filter(u => u !== activeNodeUrl),
    ].filter(Boolean);

    let lastErr = null;
    for (const url of candidates) {
      try {
        const base = url.replace(/\/$/, '');
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 75_000);
        let res;
        try {
          res = await fetch(`${base}/chat/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: q,
              walletAddress: selectedAddress,
              address: selectedAddress,
              requesterAddress: selectedAddress,
            }),
            signal: ctrl.signal,
          });
        } finally { clearTimeout(timer); }
        if (!res.ok) { lastErr = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`; continue; }
        const data = await res.json();
        return { data, base };
      } catch (e) { lastErr = e.message; }
    }
    throw new Error(lastErr || 'All nodes unreachable for chat');
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const submitText = async (q) => {
    if (!q) return;
    if (!activeNodeUrl) { setError('No node connected. Check Settings.'); return; }

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      setStatusText('Thinking...');
      const { data: askData, base } = await askNode(q);

      if (askData.type === 'chat') {
        setResult({
          type: 'chat',
          message: askData.message || askData.reply || '(no response)',
          fromChainHistory: !!askData.fromChainHistory,
        });
        setSuggestions([]);
        setHistoryBanner(null);
        setStatusText('');
        return;
      }

      // Skill path
      const maxBudget = Math.round(budget * 1_000_000_000);
      if (!(maxBudget > 0)) {
        setLoading(false);
        Alert.alert('Fee Required', 'This question needs a real-time data skill. Set a fee using the slider and try again.');
        return;
      }
      if (!selectedAddress) { setError('Select a wallet to pay the skill fee.'); return; }
      if (budget > balance)  { setError(`Insufficient balance: ${balance.toFixed(2)} POH available.`); return; }

      // Fee-required job types need a signed payment proof (paymentTx) bound to
      // jobId + miner + amount + nonce — the node rejects them with 402 otherwise.
      setStatusText('Signing fee payment...');
      const privateKeyHex = getPrivateKey ? await getPrivateKey(selectedAddress) : null;
      if (!privateKeyHex) { setError('Private key not found for this wallet.'); setLoading(false); return; }
      const { secretKey, signingPublicKey } = await deriveSigningKeypair(privateKeyHex);

      // Register signing key (idempotent) so the node can verify the proof
      try {
        await fetch(`${base}/api/wallet/register-key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: selectedAddress, signingPublicKey, proof: signData(selectedAddress, secretKey) }),
        });
      } catch { /* non-fatal — submit will fail with a clear error if key missing */ }

      const infoRes = await fetch(`${base}/api/miner/info`);
      const info = await infoRes.json();
      if (!info.minerAddress) throw new Error('Could not fetch miner address for payment proof.');

      const nonceRes = await fetch(`${base}/api/wallet/nonce?address=${encodeURIComponent(selectedAddress)}`);
      const nonceData = await nonceRes.json();
      if (nonceData.error) throw new Error(nonceData.error);

      const clientJobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const paymentTx = await buildJobPaymentTx({
        jobId: clientJobId,
        requesterAddress: selectedAddress,
        minerAddress: info.minerAddress,
        amount: maxBudget,
        nonce: nonceData.nonce || 0,
        secretKey,
      });

      setStatusText('Submitting job...');
      const jobRes = await fetch(`${base}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: clientJobId,
          type: 'skill', skillId: askData.skillId,
          payload: { ...(askData.input || {}), question: q },
          maxBudget, requesterAddress: selectedAddress,
          paymentTx,
        }),
      });
      const jobRef = await jobRes.json();
      if (!jobRes.ok || !jobRef.jobId) throw new Error(jobRef.error || 'Failed to submit job.');

      const jobId   = jobRef.jobId;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (true) {
        if (Date.now() >= deadline) throw new Error('Job timed out (2 min). Try again.');
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        const sRes = await fetch(`${base}/job/${jobId}/status`);
        const st   = await sRes.json();
        if (st.status === 'error') throw new Error(st.error || 'Job failed.');
        if (st.status === 'done')  break;
        setStatusText(`Computing... (${st.status})`);
      }

      setStatusText('Fetching result...');
      const rRes  = await fetch(`${base}/job/${jobId}/result`);
      const rData = await rRes.json();
      setResult({
        type: 'skill', skillId: askData.skillId,
        jobId:      rData?.jobId || jobId,
        output:     rData?.profile?.skillOutput ?? rData,
        nlResponse: rData?.profile?.nlResponse || null,
        tokensUsed: rData?.profile?.tokensUsed,
        feedback:   null,
      });
      setStatusText('');
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setStatusText('');
    } finally {
      setLoading(false);
    }
  };

  const submit = () => {
    const text = message.trim();
    if (!text && !attachedFile) return;
    const q = attachedFile
      ? `${text}\n\n[Attached file: ${attachedFile.name}]\n\`\`\`\n${attachedFile.content}\n\`\`\``
      : text;
    submitText(q);
    setAttachedFile(null);
  };

  const copyResponse = async () => {
    const text = result?.message || result?.nlResponse
      || (typeof result?.output === 'string' ? result.output : JSON.stringify(result?.output, null, 2));
    if (!text) return;
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Response copied to clipboard');
  };

  const sendFeedback = async (stars) => {
    if (!result?.jobId || result.feedback) return;
    try {
      await fetch(`${activeNodeUrl.replace(/\/$/, '')}/api/jobs/${result.jobId}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars, requesterAddress: selectedAddress }),
      });
      setResult(r => ({ ...r, feedback: stars }));
    } catch { Alert.alert('Error', 'Could not submit feedback.'); }
  };

  const renderSkillOutput = (output) => {
    if (output == null) return null;
    if (typeof output === 'string') return renderMarkdown(output);
    if (output.analysis?.summary) {
      return (
        <>
          <Text style={s.mdH3}>Summary</Text>
          {renderMarkdown(output.analysis.summary)}
          {output.analysis.keyTopics?.length > 0 && (
            <>
              <Text style={s.mdH3}>Key Topics</Text>
              <Text style={s.resultText}>{output.analysis.keyTopics.join(', ')}</Text>
            </>
          )}
          {Array.isArray(output.posts) && output.posts.slice(0, 5).map((p, i) => (
            <View key={i} style={s.postRow}>
              <Text style={s.postTitle}>{p.title || '(untitled)'}</Text>
              {p.excerpt ? renderMarkdown(p.excerpt) : null}
            </View>
          ))}
        </>
      );
    }
    return <Text style={s.codeText}>{JSON.stringify(output, null, 2)}</Text>;
  };

  const isSkillResult = result?.type === 'skill';

  const responseText = result?.type === 'chat'
    ? result.message
    : result?.nlResponse || null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#000' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
      >
        <TextInput
          style={s.input}
          placeholder="Ask the network anything…"
          placeholderTextColor="#4b5563"
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={3}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />

        {suggestions.length > 0 ? (
          <View style={s.suggestBox}>
            {suggestions.map((item, idx) => (
              <TouchableOpacity key={`${item.jobId || idx}`} style={s.suggestItem} onPress={() => applySuggestion(item)}>
                <Text style={s.suggestPrompt} numberOfLines={2}>{item.prompt}</Text>
                {item.replyPreview ? (
                  <Text style={s.suggestReply} numberOfLines={1}>{item.replyPreview}…</Text>
                ) : null}
                {item.fromChain ? <Text style={s.suggestBadge}>on-chain</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {historyBanner?.replyPreview ? (
          <View style={s.historyBanner}>
            <Text style={s.historyBannerLabel}>⛓ Similar question on blockchain</Text>
            <Text style={s.historyBannerReply} numberOfLines={2}>{historyBanner.replyPreview}…</Text>
            <TouchableOpacity style={s.historyBannerBtn} onPress={useChainReply}>
              <Text style={s.historyBannerBtnText}>Use cached reply</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={s.attachRow}>
          <TouchableOpacity style={s.attachBtn} onPress={pickAttachment} disabled={loading}>
            <Text style={s.attachBtnText}>📎 Attach file</Text>
          </TouchableOpacity>
          {attachedFile ? (
            <View style={s.attachChip}>
              <Text style={s.attachChipText} numberOfLines={1}>{attachedFile.name}</Text>
              <TouchableOpacity onPress={removeAttachment}>
                <Text style={s.attachChipRemove}>×</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <View style={s.feeRow}>
          <Text style={s.label}>MAX FEE <Text style={s.labelNote}>(data skills only)</Text></Text>
          <Text style={s.feeValue}>{_fmtPoh(budget)}</Text>
        </View>
        <LogSlider value={budget} onChange={setBudget} disabled={loading} />
        <View style={s.presetRow}>
          {FEE_PRESETS.map(p => {
            const pv = _pctToPoh(p.pct);
            const active = Math.abs(_pohToStep(budget) - _pohToStep(pv)) <= 1;
            return (
              <TouchableOpacity
                key={p.label}
                style={[s.presetBtn, active && s.presetBtnActive]}
                onPress={() => !loading && setBudget(pv)}
                disabled={loading}
              >
                <Text style={[s.presetText, active && s.presetTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={s.feeNote}>
          Balance: {balance.toFixed(2)} POH · fee only charged when a data skill is used
        </Text>

        {error ? (
          <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
        ) : null}

        <TouchableOpacity
          style={[s.submitBtn, (loading || (!message.trim() && !attachedFile)) && s.submitBtnDisabled]}
          onPress={submit}
          disabled={loading || (!message.trim() && !attachedFile)}
        >
          {loading ? (
            <View style={s.submitRow}>
              <ActivityIndicator color="#000" size="small" />
              <Text style={[s.submitBtnText, { marginLeft: 8 }]}>{statusText || 'Thinking...'}</Text>
            </View>
          ) : (
            <Text style={s.submitBtnText}>Ask</Text>
          )}
        </TouchableOpacity>

        {result ? (
          <View style={s.resultBox}>
            <View style={s.resultHeaderRow}>
              <Text style={s.resultHeader}>
                {isSkillResult
                  ? `${result.skillId}${result.tokensUsed ? `  ·  ${result.tokensUsed} tokens` : ''}`
                  : result.fromChainHistory ? 'AI · from chain history' : 'AI'}
              </Text>
              <TouchableOpacity style={s.copyBtn} onPress={copyResponse}>
                <Text style={s.copyBtnText}>⎘ Copy</Text>
              </TouchableOpacity>
            </View>

            <ScrollView nestedScrollEnabled style={s.resultScroll}>
              {responseText
                ? renderMarkdown(responseText)
                : renderSkillOutput(result.output)
              }
            </ScrollView>

            {isSkillResult && (
              result.feedback ? (
                <Text style={s.feedbackDone}>
                  Thanks! {'★'.repeat(result.feedback)}{'☆'.repeat(5 - result.feedback)}
                </Text>
              ) : (
                <View style={s.feedbackRow}>
                  <Text style={s.feedbackLabel}>Rate this:</Text>
                  {[1, 2, 3, 4, 5].map(n => (
                    <TouchableOpacity key={n} style={s.starBtn} onPress={() => sendFeedback(n)}>
                      <Text style={s.starBtnText}>★</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )
            )}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },

  label:     { color: '#4b5563', fontSize: 13, letterSpacing: 1.5, fontFamily: 'Iceland_400Regular', lineHeight: 19 },
  labelNote: { color: '#374151', letterSpacing: 0, textTransform: 'none' },
  feeRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  feeValue:  { color: '#22c55e', fontSize: 15, fontFamily: 'Iceland_400Regular', lineHeight: 22 },
  feeNote:   { color: '#374151', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 19, marginBottom: 12, marginTop: 2 },
  presetRow:      { flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: 8 },
  presetBtn:      { flex: 1, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#1f2937', alignItems: 'center', backgroundColor: '#0a0a0a' },
  presetBtnActive:{ borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)' },
  presetText:     { color: '#6b7280', fontSize: 12, letterSpacing: 1, fontFamily: 'Iceland_400Regular', lineHeight: 17 },
  presetTextActive:{ color: '#22c55e' },

  input: {
    backgroundColor: '#0d0d0d', color: '#fff', padding: 14,
    borderRadius: 10, marginBottom: 8, fontSize: 13,
    fontFamily: 'Iceland_400Regular', lineHeight: 19, borderWidth: 1, borderColor: '#222',
    minHeight: 72, textAlignVertical: 'top',
  },

  suggestBox: {
    backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#222',
    marginBottom: 8, overflow: 'hidden',
  },
  suggestItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  suggestPrompt: { color: '#d1d5db', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 18 },
  suggestReply: { color: '#6b7280', fontSize: 11, fontStyle: 'italic', marginTop: 2, fontFamily: 'Iceland_400Regular', lineHeight: 16 },
  suggestBadge: { color: '#22c55e', fontSize: 10, fontFamily: 'monospace', marginTop: 3 },

  historyBanner: {
    backgroundColor: '#0f1f14', borderRadius: 8, padding: 10, marginBottom: 10,
    borderWidth: 1, borderColor: '#1e3a2a',
  },
  historyBannerLabel: { color: '#4ade80', fontSize: 11, fontFamily: 'Iceland_400Regular', lineHeight: 16, marginBottom: 4 },
  historyBannerReply: { color: '#9ca3af', fontSize: 12, fontStyle: 'italic', fontFamily: 'Iceland_400Regular', lineHeight: 17, marginBottom: 8 },
  historyBannerBtn: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, borderWidth: 1, borderColor: '#22c55e', backgroundColor: '#166534' },
  historyBannerBtnText: { color: '#22c55e', fontSize: 11, fontFamily: 'monospace' },

  errorBox:  { backgroundColor: '#1c0a0a', borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#ef4444' },
  errorText: { color: '#ef4444', fontSize: 15, fontFamily: 'Iceland_400Regular', lineHeight: 22 },

  attachRow:       { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' },
  attachBtn:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#0d0d0d' },
  attachBtnText:   { color: '#9ca3af', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 19 },
  attachChip:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', maxWidth: 200 },
  attachChipText:  { color: '#22c55e', fontSize: 12, fontFamily: 'monospace', flexShrink: 1 },
  attachChipRemove: { color: '#f87171', fontSize: 16, fontWeight: '700', paddingHorizontal: 2 },

  submitBtn:         { backgroundColor: '#22c55e', padding: 14, borderRadius: 4, alignItems: 'center', marginBottom: 14 },
  submitBtnDisabled: { backgroundColor: '#166534', opacity: 0.7 },
  submitBtnText:     { color: '#000', fontWeight: '700', fontSize: 16, fontFamily: 'Iceland_400Regular', lineHeight: 23 },
  submitRow:         { flexDirection: 'row', alignItems: 'center' },

  resultBox:       { backgroundColor: '#0a0a0a', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#1f2f1f' },
  resultHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  resultHeader:    { color: '#22c55e', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 19, letterSpacing: 1, flex: 1 },
  copyBtn:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: '#2a2a2a' },
  copyBtnText:     { color: '#6b7280', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 20 },
  resultScroll:    { maxHeight: 400 },

  // Markdown styles
  resultText:  { color: '#e5e7eb', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 22 },
  mdH1:        { color: '#fff', fontSize: 20, fontWeight: '700', fontFamily: 'Iceland_400Regular', lineHeight: 29, marginTop: 12, marginBottom: 6 },
  mdH2:        { color: '#fff', fontSize: 17, fontWeight: '700', fontFamily: 'Iceland_400Regular', lineHeight: 25, marginTop: 10, marginBottom: 4 },
  mdH3:        { color: '#22c55e', fontSize: 15, fontWeight: '700', fontFamily: 'Iceland_400Regular', lineHeight: 22, marginTop: 8, marginBottom: 4, letterSpacing: 0.5 },
  mdBullet:    { color: '#e5e7eb', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 22, marginBottom: 2, paddingLeft: 4 },
  mdRule:      { height: 1, backgroundColor: '#222', marginVertical: 10 },
  inlineCode:  { fontFamily: 'monospace', backgroundColor: '#1a1a1a', color: '#22c55e', borderRadius: 3, paddingHorizontal: 3 },
  codeBlock:   { backgroundColor: '#0d0d0d', borderRadius: 8, padding: 12, marginVertical: 8, borderWidth: 1, borderColor: '#222' },
  codeText:    { color: '#9ca3af', fontSize: 13, fontFamily: 'monospace', lineHeight: 18 },

  postRow:     { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  postTitle:   { color: '#fff', fontSize: 15, fontFamily: 'Iceland_400Regular', lineHeight: 22, marginBottom: 4 },

  feedbackRow:  { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 4 },
  feedbackLabel: { color: '#4b5563', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 20, marginRight: 4 },
  starBtn:      { padding: 2 },
  starBtnText:  { fontSize: 20, color: '#374151' },
  feedbackDone: { color: '#6b7280', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 20, marginTop: 12 },
});
