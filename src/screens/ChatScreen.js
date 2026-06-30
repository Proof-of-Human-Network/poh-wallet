import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert, PanResponder,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

const MAX_ATTACH_BYTES = 100 * 1024;

// ── Log budget slider ──────────────────────────────────────────────────────────
const LOG_MIN = 0.01, LOG_MAX = 200, LOG_STEPS = 200;
const _stepToPoh = s => s <= 0 ? 0 : LOG_MIN * Math.pow(LOG_MAX / LOG_MIN, (s - 1) / (LOG_STEPS - 1));
const _pohToStep = v => v <= 0 ? 0 : Math.round(1 + (LOG_STEPS - 1) * Math.log(v / LOG_MIN) / Math.log(LOG_MAX / LOG_MIN));
const _fmtPoh = p => p < 0.1 ? p.toFixed(3) : p < 10 ? p.toFixed(2) : p < 100 ? p.toFixed(1) : Math.round(p).toString();

function LogSlider({ value, onChange, disabled }) {
  const [trackWidth, setTrackWidth] = useState(1);
  const step = _pohToStep(value);
  const fillPct = step <= 0 ? 0 : ((step - 1) / (LOG_STEPS - 1)) * 100;
  const stepRef = useRef(step);
  stepRef.current = step;
  const trackWidthRef = useRef(trackWidth);
  trackWidthRef.current = trackWidth;

  const clampStep = (x) => {
    const s = Math.round((x / trackWidthRef.current) * LOG_STEPS);
    return Math.max(0, Math.min(LOG_STEPS, s));
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder:  () => !disabled,
    onPanResponderGrant: (e) => onChange(_stepToPoh(clampStep(e.nativeEvent.locationX))),
    onPanResponderMove:  (e) => onChange(_stepToPoh(clampStep(e.nativeEvent.locationX))),
  })).current;

  return (
    <View
      onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}
      {...panResponder.panHandlers}
      style={{ height: 36, justifyContent: 'center', paddingVertical: 10 }}
    >
      <View style={{ height: 3, backgroundColor: '#2a2a2a', borderRadius: 2 }}>
        <View style={{ width: `${fillPct}%`, height: 3, backgroundColor: '#22c55e', borderRadius: 2 }} />
      </View>
      {step > 0 && (
        <View style={{
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
export default function ChatScreen({ activeNodeUrl, nodes = [], selectedAddress, balances }) {
  const [message,    setMessage]    = useState('');
  const [budget,     setBudget]     = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [statusText, setStatusText] = useState('');
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState(null);
  const [attachedFile, setAttachedFile] = useState(null); // { name, content }

  const balance = selectedAddress ? (balances?.[selectedAddress] ?? 0) : 0;

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
            body: JSON.stringify({ message: q, walletAddress: selectedAddress, address: selectedAddress }),
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
        setResult({ type: 'chat', message: askData.message || askData.reply || '(no response)' });
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

      setStatusText('Submitting job...');
      const jobRes = await fetch(`${base}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'skill', skillId: askData.skillId,
          payload: { ...(askData.input || {}), question: q },
          maxBudget, requesterAddress: selectedAddress,
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
          <Text style={s.feeValue}>{budget <= 0 ? 'no fee' : `${_fmtPoh(budget)} POH`}</Text>
        </View>
        <LogSlider value={budget} onChange={setBudget} disabled={loading} />
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
                  : 'AI'}
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

  label:     { color: '#4b5563', fontSize: 13, letterSpacing: 1.5, fontFamily: 'Iceland_400Regular' },
  labelNote: { color: '#374151', letterSpacing: 0, textTransform: 'none' },
  feeRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  feeValue:  { color: '#22c55e', fontSize: 15, fontFamily: 'Iceland_400Regular' },
  feeNote:   { color: '#374151', fontSize: 13, fontFamily: 'Iceland_400Regular', marginBottom: 12, marginTop: 2 },

  input: {
    backgroundColor: '#0d0d0d', color: '#fff', padding: 14,
    borderRadius: 10, marginBottom: 12, fontSize: 13,
    fontFamily: 'Iceland_400Regular', borderWidth: 1, borderColor: '#222',
    minHeight: 72, textAlignVertical: 'top',
  },

  errorBox:  { backgroundColor: '#1c0a0a', borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#ef4444' },
  errorText: { color: '#ef4444', fontSize: 15, fontFamily: 'Iceland_400Regular' },

  attachRow:       { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' },
  attachBtn:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#0d0d0d' },
  attachBtnText:   { color: '#9ca3af', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  attachChip:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', maxWidth: 200 },
  attachChipText:  { color: '#22c55e', fontSize: 12, fontFamily: 'monospace', flexShrink: 1 },
  attachChipRemove: { color: '#f87171', fontSize: 16, fontWeight: '700', paddingHorizontal: 2 },

  submitBtn:         { backgroundColor: '#22c55e', padding: 14, borderRadius: 4, alignItems: 'center', marginBottom: 14 },
  submitBtnDisabled: { backgroundColor: '#166534', opacity: 0.7 },
  submitBtnText:     { color: '#000', fontWeight: '700', fontSize: 16, fontFamily: 'Iceland_400Regular' },
  submitRow:         { flexDirection: 'row', alignItems: 'center' },

  resultBox:       { backgroundColor: '#0a0a0a', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#1f2f1f' },
  resultHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  resultHeader:    { color: '#22c55e', fontSize: 13, fontFamily: 'Iceland_400Regular', letterSpacing: 1, flex: 1 },
  copyBtn:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: '#2a2a2a' },
  copyBtnText:     { color: '#6b7280', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  resultScroll:    { maxHeight: 400 },

  // Markdown styles
  resultText:  { color: '#e5e7eb', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 22 },
  mdH1:        { color: '#fff', fontSize: 20, fontWeight: '700', fontFamily: 'Iceland_400Regular', marginTop: 12, marginBottom: 6 },
  mdH2:        { color: '#fff', fontSize: 17, fontWeight: '700', fontFamily: 'Iceland_400Regular', marginTop: 10, marginBottom: 4 },
  mdH3:        { color: '#22c55e', fontSize: 15, fontWeight: '700', fontFamily: 'Iceland_400Regular', marginTop: 8, marginBottom: 4, letterSpacing: 0.5 },
  mdBullet:    { color: '#e5e7eb', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 22, marginBottom: 2, paddingLeft: 4 },
  mdRule:      { height: 1, backgroundColor: '#222', marginVertical: 10 },
  inlineCode:  { fontFamily: 'monospace', backgroundColor: '#1a1a1a', color: '#22c55e', borderRadius: 3, paddingHorizontal: 3 },
  codeBlock:   { backgroundColor: '#0d0d0d', borderRadius: 8, padding: 12, marginVertical: 8, borderWidth: 1, borderColor: '#222' },
  codeText:    { color: '#9ca3af', fontSize: 13, fontFamily: 'monospace', lineHeight: 18 },

  postRow:     { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  postTitle:   { color: '#fff', fontSize: 15, fontFamily: 'Iceland_400Regular', marginBottom: 4 },

  feedbackRow:  { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 4 },
  feedbackLabel: { color: '#4b5563', fontSize: 14, fontFamily: 'Iceland_400Regular', marginRight: 4 },
  starBtn:      { padding: 2 },
  starBtnText:  { fontSize: 20, color: '#374151' },
  feedbackDone: { color: '#6b7280', fontSize: 14, fontFamily: 'Iceland_400Regular', marginTop: 12 },
});
