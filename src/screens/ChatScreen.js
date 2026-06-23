import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Modal,
  ActivityIndicator, StyleSheet, Alert, PanResponder,
  Animated, Easing, NativeModules,
} from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';

// Only use Voice if the native module is actually linked in the current build
let Voice = null;
try {
  if (NativeModules.RCTVoice) {
    Voice = require('@react-native-voice/voice').default;
  }
} catch { /* not linked yet */ }

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

// ── Live Sphere ────────────────────────────────────────────────────────────────
const RINGS = [
  { r: 30,  sw: 1.0, op: 0.18, dash: '80 28'  },
  { r: 45,  sw: 0.6, op: 0.28, dash: '55 18'  },
  { r: 58,  sw: 1.8, op: 0.42, dash: '110 10' },
  { r: 70,  sw: 0.8, op: 0.52, dash: '70 8'   },
  { r: 82,  sw: 2.2, op: 0.62, dash: '140 14' },
  { r: 92,  sw: 0.5, op: 0.48, dash: '45 11'  },
  { r: 102, sw: 1.6, op: 0.68, dash: '100 8'  },
  { r: 112, sw: 1.0, op: 0.58, dash: '80 20'  },
  { r: 122, sw: 2.8, op: 0.76, dash: '130 6'  },
  { r: 130, sw: 0.5, op: 0.36, dash: '35 30'  },
  { r: 138, sw: 1.6, op: 0.50, dash: '65 14'  },
  { r: 146, sw: 0.8, op: 0.30, dash: '50 24'  },
  { r: 154, sw: 1.2, op: 0.22, dash: '42 32'  },
];

function LiveSphere({ listening = false, size = 180 }) {
  const rotation = useRef(new Animated.Value(0)).current;
  const pulse    = useRef(new Animated.Value(1)).current;
  const cx = size / 2;

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1, duration: listening ? 1600 : 14000,
        easing: Easing.linear, useNativeDriver: true,
      })
    );
    spin.start();
    return () => spin.stop();
  }, [listening]);

  useEffect(() => {
    if (listening) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.08, duration: 480, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.93, duration: 480, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    } else {
      Animated.timing(pulse, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [listening]);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Svg width={size} height={size}>
          {RINGS.map((ring, i) => (
            <Circle
              key={i} cx={cx} cy={cx} r={ring.r}
              fill="none" stroke="#22c55e"
              strokeWidth={ring.sw} strokeOpacity={ring.op}
              strokeDasharray={ring.dash}
            />
          ))}
          {/* Digital glitch blocks */}
          <Rect x={cx + 90}  y={cx - 6}  width={28} height={9}  fill="#22c55e" opacity={0.70} />
          <Rect x={cx - 138} y={cx + 50} width={38} height={7}  fill="#22c55e" opacity={0.55} />
          <Rect x={cx + 100} y={cx + 84} width={18} height={11} fill="#22c55e" opacity={0.80} />
          <Rect x={cx - 118} y={cx - 98} width={30} height={6}  fill="#22c55e" opacity={0.50} />
          <Rect x={cx + 56}  y={cx - 134}width={22} height={8}  fill="#22c55e" opacity={0.65} />
          <Rect x={cx - 86}  y={cx + 114}width={26} height={6}  fill="#22c55e" opacity={0.45} />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

// ── Countdown digit animation ──────────────────────────────────────────────────
function CountdownDigit({ digit }) {
  const scale = useRef(new Animated.Value(1.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scale.setValue(1.6);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(scale,   { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.delay(500),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]),
    ]).start();
  }, [digit]);

  return (
    <Animated.Text style={[s.countdownDigit, { transform: [{ scale }], opacity }]}>
      {digit}
    </Animated.Text>
  );
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

  // Voice state
  const [voicePhase,  setVoicePhase]  = useState(null); // null | 'countdown' | 'listening'
  const [countdown,   setCountdown]   = useState(3);
  const [transcript,  setTranscript]  = useState('');
  const countdownRef = useRef(null);

  const balance = selectedAddress ? (balances?.[selectedAddress] ?? 0) : 0;

  // ── Voice init / cleanup ──────────────────────────────────────────────────
  useEffect(() => {
    if (!Voice) return;
    Voice.onSpeechResults = (e) => {
      const text = e.value?.[0] || '';
      setTranscript(text);
    };
    Voice.onSpeechPartialResults = (e) => {
      const text = e.value?.[0] || '';
      setTranscript(text);
    };
    Voice.onSpeechError = (e) => {
      console.log('[Voice] error', e);
      cancelVoice();
    };
    return () => {
      Voice.destroy().catch(() => {});
    };
  }, []);

  const startCountdown = () => {
    setVoicePhase('countdown');
    setCountdown(3);
    setTranscript('');
    let n = 3;
    const tick = () => {
      n -= 1;
      if (n > 0) {
        setCountdown(n);
        countdownRef.current = setTimeout(tick, 1000);
      } else {
        beginListening();
      }
    };
    countdownRef.current = setTimeout(tick, 1000);
  };

  const beginListening = async () => {
    setVoicePhase('listening');
    if (Voice) {
      try {
        await Voice.start('en-US');
      } catch (e) {
        console.log('[Voice] start error', e);
        setVoicePhase(null);
        Alert.alert('Voice unavailable', 'Rebuild the app to enable voice input (expo run:android).');
      }
    }
  };

  const cancelVoice = () => {
    clearTimeout(countdownRef.current);
    if (Voice) Voice.stop().catch(() => {});
    setVoicePhase(null);
    setTranscript('');
  };

  const onSphereTap = () => {
    if (voicePhase === null) {
      startCountdown();
    } else if (voicePhase === 'listening') {
      // Stop recording and use transcript
      if (Voice) Voice.stop().catch(() => {});
      const finalText = transcript.trim();
      setVoicePhase(null);
      setTranscript('');
      if (finalText) {
        setMessage(finalText);
        // Auto-submit after a short delay so message state settles
        setTimeout(() => submitText(finalText), 80);
      }
    }
  };

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

  // ── Submit (accepts explicit text to handle voice path) ───────────────────
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
        const msg = askData.message || askData.reply || '(no response)';
        setResult({ type: 'chat', message: msg });
        setStatusText('');
        return;
      }

      // Skill path
      const maxBudget = Math.round(budget * 1_000_000_000);
      if (!(maxBudget > 0)) {
        setLoading(false);
        Alert.alert('Fee Required', 'This question needs a real-time data skill. Set a fee using the slider and try again.', [{ text: 'OK' }]);
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

  const submit = () => submitText(message.trim());

  const copyResponse = async () => {
    const text = result?.message || result?.nlResponse
      || (typeof result?.output === 'string' ? result.output : JSON.stringify(result?.output, null, 2));
    if (!text) return;
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Response copied to clipboard');
  };

  const sendFeedback = async (rating) => {
    if (!result?.jobId || result.feedback) return;
    try {
      await fetch(`${activeNodeUrl.replace(/\/$/, '')}/api/jobs/${result.jobId}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, requesterAddress: selectedAddress }),
      });
      setResult(r => ({ ...r, feedback: rating }));
    } catch { Alert.alert('Error', 'Could not submit feedback.'); }
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
    <>
      {/* ── Voice modal ────────────────────────────────────────────────────── */}
      <Modal
        visible={voicePhase !== null}
        transparent={false}
        animationType="fade"
        statusBarTranslucent
      >
        <View style={s.voiceModal}>
          {voicePhase === 'countdown' ? (
            <>
              <Text style={s.voiceTitle}>Start speaking in</Text>
              <CountdownDigit digit={countdown} />
            </>
          ) : (
            <>
              <TouchableOpacity onPress={onSphereTap} activeOpacity={0.9}>
                <LiveSphere listening size={320} />
              </TouchableOpacity>
              <Text style={s.voiceListening}>Listening…</Text>
              {transcript ? (
                <Text style={s.voiceTranscript} numberOfLines={4}>{transcript}</Text>
              ) : null}
              <Text style={s.voiceHint}>Tap sphere to send</Text>
            </>
          )}
          <TouchableOpacity style={s.voiceCancel} onPress={cancelVoice}>
            <Text style={s.voiceCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Main screen ────────────────────────────────────────────────────── */}
      <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.heading}>ASK THE NETWORK</Text>
        <Text style={s.sub}>Simple questions are free. Real-time data queries use a skill and require a small fee.</Text>

        {/* Sphere */}
        <TouchableOpacity
          style={s.sphereWrap}
          onPress={onSphereTap}
          activeOpacity={0.85}
        >
          <LiveSphere listening={false} size={360} />
          <Text style={s.sphereHint}>{Voice ? 'Tap to speak' : 'Voice unavailable'}</Text>
        </TouchableOpacity>

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

        <View style={s.feeRow}>
          <Text style={s.label}>MAX FEE <Text style={s.labelNote}>(data skills only)</Text></Text>
          <Text style={s.feeValue}>{budget <= 0 ? 'no fee' : `${_fmtPoh(budget)} POH`}</Text>
        </View>
        <LogSlider value={budget} onChange={setBudget} disabled={loading} />
        <Text style={s.feeNote}>
          Balance: {balance.toFixed(2)} POH · fee only deducted when a data skill is used
        </Text>

        {error ? (
          <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
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
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 20 },

  heading: { color: '#4b5563', fontSize: 13, letterSpacing: 1.5, fontFamily: 'Iceland_400Regular', marginBottom: 4 },
  sub:     { color: '#6b7280', fontSize: 15, fontFamily: 'Iceland_400Regular', marginBottom: 16 },

  // Sphere
  sphereWrap: { alignItems: 'center', marginBottom: 8 },
  sphereHint: { color: '#374151', fontSize: 12, fontFamily: 'Iceland_400Regular', marginTop: 4, letterSpacing: 1 },

  input: {
    backgroundColor: '#111', color: '#fff', padding: 14,
    borderRadius: 10, marginBottom: 16, fontSize: 13,
    fontFamily: 'Iceland_400Regular', borderWidth: 1, borderColor: '#1f1f1f',
    minHeight: 80, textAlignVertical: 'top',
  },

  label:     { color: '#4b5563', fontSize: 13, letterSpacing: 1.5, fontFamily: 'Iceland_400Regular' },
  labelNote: { color: '#374151', letterSpacing: 0, textTransform: 'none' },
  feeRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  feeValue:  { color: '#22c55e', fontSize: 15, fontFamily: 'Iceland_400Regular' },
  feeNote:   { color: '#374151', fontSize: 13, fontFamily: 'Iceland_400Regular', marginBottom: 12, marginTop: 2 },

  errorBox:  { backgroundColor: '#1c0a0a', borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#ef4444' },
  errorText: { color: '#ef4444', fontSize: 15, fontFamily: 'Iceland_400Regular' },

  submitBtn:         { backgroundColor: '#22c55e', padding: 16, borderRadius: 4, alignItems: 'center', marginBottom: 16 },
  submitBtnDisabled: { backgroundColor: '#166534', opacity: 0.7 },
  submitBtnText:     { color: '#000', fontWeight: '700', fontSize: 16, fontFamily: 'Iceland_400Regular' },
  submitRow:         { flexDirection: 'row', alignItems: 'center' },

  resultBox:       { backgroundColor: '#0d0d0d', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1f2f1f' },
  resultHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  resultHeader:    { color: '#22c55e', fontSize: 13, fontFamily: 'Iceland_400Regular', letterSpacing: 1, flex: 1 },
  copyBtn:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: '#2a2a2a' },
  copyBtnText:     { color: '#6b7280', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  resultScroll:    { maxHeight: 420 },
  resultText:      { color: '#e5e7eb', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 20 },
  resultJson:      { color: '#9ca3af', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 16 },
  resultSection:   { color: '#4b5563', fontSize: 15, letterSpacing: 1.5, fontFamily: 'Iceland_400Regular', marginTop: 12, marginBottom: 4 },
  postRow:         { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  postTitle:       { color: '#fff', fontSize: 15, fontFamily: 'Iceland_400Regular' },
  postExcerpt:     { color: '#6b7280', fontSize: 14, fontFamily: 'Iceland_400Regular', marginTop: 3, lineHeight: 16 },
  feedbackRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  feedbackLabel:   { color: '#4b5563', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  fbBtn:           { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#2a2a2a' },
  fbBtnText:       { fontSize: 16 },
  feedbackDone:    { color: '#6b7280', fontSize: 14, fontFamily: 'Iceland_400Regular', marginTop: 12 },

  // Voice modal
  voiceModal: {
    flex: 1, backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32,
  },
  voiceTitle: {
    color: '#fff', fontSize: 22, fontFamily: 'Iceland_400Regular',
    letterSpacing: 2, marginBottom: 20,
  },
  countdownDigit: {
    color: '#22c55e', fontSize: 130, fontFamily: 'Iceland_400Regular',
    lineHeight: 140,
  },
  voiceListening: {
    color: '#fff', fontSize: 18, fontFamily: 'Iceland_400Regular',
    letterSpacing: 2, marginTop: 24,
  },
  voiceTranscript: {
    color: '#9ca3af', fontSize: 15, fontFamily: 'Iceland_400Regular',
    textAlign: 'center', marginTop: 16, lineHeight: 22,
  },
  voiceHint: {
    color: '#374151', fontSize: 13, fontFamily: 'Iceland_400Regular',
    letterSpacing: 1, marginTop: 12,
  },
  voiceCancel: {
    position: 'absolute', bottom: 60,
    paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 24, borderWidth: 1, borderColor: '#333',
  },
  voiceCancelText: { color: '#9ca3af', fontSize: 15, fontFamily: 'Iceland_400Regular' },
});
