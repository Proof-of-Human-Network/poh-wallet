import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

const BUDGET_PRESETS = [1, 5, 10, 25, 50, 100, 250, 500];
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

export default function ChatScreen({ activeNodeUrl, nodes = [], selectedAddress, balances }) {
  const [message, setMessage]     = useState('');
  const [budget, setBudget]       = useState(1);
  const [loading, setLoading]     = useState(false);
  const [statusText, setStatusText] = useState('');
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState(null);

  const balance = selectedAddress ? (balances?.[selectedAddress] ?? 0) : 0;

  // Try /chat/ask on each node until one responds usefully
  async function askNode(q) {
    const candidates = [
      activeNodeUrl,
      ...nodes.map(n => n.url).filter(u => u !== activeNodeUrl),
    ].filter(Boolean);

    let lastErr = null;
    for (const url of candidates) {
      try {
        const base = url.replace(/\/$/, '');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 35_000);
        let res;
        try {
          res = await fetch(`${base}/chat/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: q, walletAddress: selectedAddress, address: selectedAddress }),
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) { lastErr = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`; continue; }
        const data = await res.json();
        return { data, base };
      } catch (e) { lastErr = e.message; }
    }
    throw new Error(lastErr || 'All nodes unreachable for chat');
  }

  const submit = async () => {
    const q = message.trim();
    if (!q) return;
    if (!activeNodeUrl) { setError('No node connected. Check Settings.'); return; }

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      setStatusText('Thinking...');
      const { data: askData, base } = await askNode(q);

      // ── Free LLM answer — no job, no fee ─────────────────────────────────
      if (askData.type === 'chat') {
        const msg = askData.message || askData.reply || '(no response)';
        setResult({ type: 'chat', message: msg, skillId: null, jobId: null });
        setStatusText('');
        return;
      }

      // ── Skill-based answer — requires budget ──────────────────────────────
      const maxBudget = Math.round(budget * 1_000_000_000);
      if (!(maxBudget > 0)) {
        setLoading(false);
        Alert.alert(
          'Fee Required for Data Skills',
          'This question needs a real-time data skill. Set a fee using the slider above and try again.',
          [{ text: 'OK' }]
        );
        return;
      }
      if (!selectedAddress) { setError('Select a wallet to pay the skill fee.'); return; }
      if (budget > balance)  { setError(`Insufficient balance: ${balance.toFixed(2)} POH available.`); return; }

      setStatusText('Submitting job...');
      const jobBody = {
        type: 'skill',
        skillId: askData.skillId,
        payload: { ...(askData.input || {}), question: q },
        maxBudget,
        requesterAddress: selectedAddress,
      };
      const jobRes = await fetch(`${base}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobBody),
      });
      const jobRef = await jobRes.json();
      if (!jobRes.ok || !jobRef.jobId) throw new Error(jobRef.error || 'Failed to submit job to the network.');

      const jobId   = jobRef.jobId;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (true) {
        if (Date.now() >= deadline) throw new Error('Job timed out (2 min). Try again.');
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        const sRes = await fetch(`${base}/job/${jobId}/status`);
        const s    = await sRes.json();
        if (s.status === 'error') throw new Error(s.error || 'Job failed on the network.');
        if (s.status === 'done')  break;
        setStatusText(`Computing... (${s.status})`);
      }

      setStatusText('Fetching result...');
      const rRes  = await fetch(`${base}/job/${jobId}/result`);
      const rData = await rRes.json();
      setResult({
        type:       'skill',
        skillId:    askData.skillId,
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

  const copyResponse = async () => {
    const text = result?.message
      || result?.nlResponse
      || (typeof result?.output === 'string' ? result.output : JSON.stringify(result?.output, null, 2));
    if (!text) return;
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Response copied to clipboard');
  };

  const sendFeedback = async (rating) => {
    if (!result?.jobId || result.feedback) return;
    try {
      const base = activeNodeUrl.replace(/\/$/, '');
      await fetch(`${base}/api/jobs/${result.jobId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, requesterAddress: selectedAddress }),
      });
      setResult(r => ({ ...r, feedback: rating }));
    } catch {
      Alert.alert('Error', 'Could not submit feedback.');
    }
  };

  const renderSkillOutput = (output) => {
    if (output == null) return null;
    if (typeof output === 'string') return <Text style={s.resultText}>{output}</Text>;
    if (output.analysis?.summary) {
      return (
        <>
          <Text style={s.resultSection}>SUMMARY</Text>
          <Text style={s.resultText}>{output.analysis.summary}</Text>
          {output.analysis.keyTopics?.length > 0 && (
            <>
              <Text style={s.resultSection}>KEY TOPICS</Text>
              <Text style={s.resultText}>{output.analysis.keyTopics.join(', ')}</Text>
            </>
          )}
          {Array.isArray(output.posts) && output.posts.slice(0, 5).map((p, i) => (
            <View key={i} style={s.postRow}>
              <Text style={s.postTitle}>{p.title || '(untitled)'}</Text>
              {p.excerpt ? <Text style={s.postExcerpt}>{p.excerpt}</Text> : null}
            </View>
          ))}
        </>
      );
    }
    return <Text style={s.resultJson}>{JSON.stringify(output, null, 2)}</Text>;
  };

  const isSkillResult = result?.type === 'skill';

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.heading}>ASK THE NETWORK</Text>
      <Text style={s.sub}>Simple questions are free. Real-time data queries use a skill and require a small fee.</Text>

      <TextInput
        style={s.input}
        placeholder={"What's the latest from vitalik.eth on Paragraph?"}
        placeholderTextColor="#4b5563"
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={3}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />

      <Text style={s.label}>MAX FEE <Text style={s.labelNote}>(only for data skill queries)</Text></Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.feeScroll}
        contentContainerStyle={s.feeScrollContent}
      >
        {BUDGET_PRESETS.map(p => (
          <TouchableOpacity
            key={p}
            style={[s.feeChip, budget === p && s.feeChipActive]}
            onPress={() => setBudget(p)}
            disabled={loading}
          >
            <Text style={[s.feeChipText, budget === p && s.feeChipTextActive]}>
              {p} POH
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={s.feeNote}>
        Balance: {balance.toFixed(2)} POH · fee only deducted when a data skill is used
      </Text>

      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[s.submitBtn, (loading || !message.trim()) && s.submitBtnDisabled]}
        onPress={submit}
        disabled={loading || !message.trim()}
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
                : 'AI'}
            </Text>
            <TouchableOpacity style={s.copyBtn} onPress={copyResponse}>
              <Text style={s.copyBtnText}>⎘ Copy</Text>
            </TouchableOpacity>
          </View>
          <ScrollView nestedScrollEnabled style={s.resultScroll}>
            {result.type === 'chat'
              ? <Text style={s.resultText}>{result.message}</Text>
              : result.nlResponse
                ? <Text style={s.resultText}>{result.nlResponse}</Text>
                : renderSkillOutput(result.output)
            }
          </ScrollView>
          {isSkillResult && (
            result.feedback ? (
              <Text style={s.feedbackDone}>
                {result.feedback === 'positive' ? '👍 Thanks for your feedback!' : '👎 Noted — miner penalised'}
              </Text>
            ) : (
              <View style={s.feedbackRow}>
                <Text style={s.feedbackLabel}>Helpful?</Text>
                <TouchableOpacity style={s.fbBtn} onPress={() => sendFeedback('positive')}>
                  <Text style={s.fbBtnText}>👍</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.fbBtn} onPress={() => sendFeedback('negative')}>
                  <Text style={s.fbBtnText}>👎</Text>
                </TouchableOpacity>
              </View>
            )
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 20 },

  heading: { color: '#4b5563', fontSize: 10, letterSpacing: 1.5, fontFamily: 'Iceland_400Regular', marginBottom: 4 },
  sub: { color: '#6b7280', fontSize: 12, fontFamily: 'Iceland_400Regular', marginBottom: 16 },

  input: {
    backgroundColor: '#111', color: '#fff', padding: 14,
    borderRadius: 10, marginBottom: 16, fontSize: 13,
    fontFamily: 'Iceland_400Regular', borderWidth: 1, borderColor: '#1f1f1f',
    minHeight: 80, textAlignVertical: 'top',
  },

  label: { color: '#4b5563', fontSize: 10, letterSpacing: 1.5, fontFamily: 'Iceland_400Regular', marginBottom: 8 },
  labelNote: { color: '#374151', letterSpacing: 0, textTransform: 'none' },
  feeScroll: { marginBottom: 4 },
  feeScrollContent: { gap: 8, paddingRight: 4 },
  feeChip: {
    paddingHorizontal: 16, paddingVertical: 9,
    backgroundColor: '#111', borderRadius: 20,
    borderWidth: 1, borderColor: '#222',
  },
  feeChipActive: { backgroundColor: '#0f1a0f', borderColor: '#22c55e' },
  feeChipText: { color: '#9ca3af', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  feeChipTextActive: { color: '#22c55e' },
  feeNote: { color: '#374151', fontSize: 10, fontFamily: 'Iceland_400Regular', marginBottom: 16, marginTop: 4 },

  errorBox: {
    backgroundColor: '#1c0a0a', borderRadius: 8, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: '#ef4444',
  },
  errorText: { color: '#ef4444', fontSize: 12, fontFamily: 'Iceland_400Regular' },

  submitBtn: { backgroundColor: '#22c55e', padding: 16, borderRadius: 4, alignItems: 'center', marginBottom: 16 },
  submitBtnDisabled: { backgroundColor: '#166534', opacity: 0.7 },
  submitBtnText: { color: '#000', fontWeight: '700', fontSize: 16, fontFamily: 'Iceland_400Regular' },
  submitRow: { flexDirection: 'row', alignItems: 'center' },

  resultBox: {
    backgroundColor: '#0d0d0d', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#1f2f1f',
  },
  resultHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  resultHeader: { color: '#22c55e', fontSize: 10, fontFamily: 'Iceland_400Regular', letterSpacing: 1, flex: 1 },
  copyBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: '#2a2a2a' },
  copyBtnText: { color: '#6b7280', fontSize: 11, fontFamily: 'Iceland_400Regular' },
  resultScroll: { maxHeight: 420 },
  resultText: { color: '#e5e7eb', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 20 },
  resultJson: { color: '#9ca3af', fontSize: 11, fontFamily: 'Iceland_400Regular', lineHeight: 16 },
  resultSection: { color: '#4b5563', fontSize: 9, letterSpacing: 1.5, fontFamily: 'Iceland_400Regular', marginTop: 12, marginBottom: 4 },
  postRow: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  postTitle: { color: '#fff', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  postExcerpt: { color: '#6b7280', fontSize: 11, fontFamily: 'Iceland_400Regular', marginTop: 3, lineHeight: 16 },

  feedbackRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  feedbackLabel: { color: '#4b5563', fontSize: 11, fontFamily: 'Iceland_400Regular' },
  fbBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#2a2a2a' },
  fbBtnText: { fontSize: 16 },
  feedbackDone: { color: '#6b7280', fontSize: 11, fontFamily: 'Iceland_400Regular', marginTop: 12 },
});
