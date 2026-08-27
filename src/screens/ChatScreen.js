import React, { useState, useRef, useEffect, useCallback } from 'react';
import { fetchChatSuggestions, fetchHistoryMatch } from '../services/nodeClient';
import { deriveSigningKeypair, signData, buildJobPaymentTx } from '../services/signing';
import { STABLE_TICKERS, assetMeta } from '../constants/assets';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert, PanResponder,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
// Mirrors FEEDBACK_COMMENT_MAX in dev/node/src/miner-node.js — keep in sync.
const FEEDBACK_COMMENT_MAX = 300;

import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

// Matches miner MAX_ATTACHMENT_BYTES (1 MB). Text inlined; images as data URLs.
const MAX_ATTACH_BYTES = 1 * 1024 * 1024;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const TEXT_EXT_RE = /\.(txt|md|markdown|json|csv|log|js|jsx|ts|tsx|py|html?|css|ya?ml|xml|sh|sql|rs|go|java|c|cpp|h|rb|php)$/i;

// ── Log fee slider: 1 kDAI (=1000 μDAI, 1e-6 DAI) → 1 DAI, logarithmic ─────────
const LOG_MIN = 0.000001, LOG_MAX = 1, LOG_STEPS = 200;   // floor = 1 kDAI = 1000 μDAI
const _stepToDai = s => s <= 0 ? LOG_MIN : LOG_MIN * Math.pow(LOG_MAX / LOG_MIN, (s - 1) / (LOG_STEPS - 1));
const _daiToStep = v => v <= LOG_MIN ? 1 : Math.round(1 + (LOG_STEPS - 1) * Math.log(v / LOG_MIN) / Math.log(LOG_MAX / LOG_MIN));
// Value at a fraction [0,1] of the log range — used by the preset marks.
const _pctToDai = pct => LOG_MIN * Math.pow(LOG_MAX / LOG_MIN, pct);
// Preset marks: default 0% (= 1 kDAI = 1000 μDAI), low 25%, high 60%, max 100%.
const FEE_PRESETS = [
  { label: 'Default', pct: 0.00 },
  { label: 'Low',     pct: 0.25 },
  { label: 'High',    pct: 0.60 },
  { label: 'Max',     pct: 1.00 },
];
const _fmtDai = p => {
  if (p <= 0) return '0';
  const k = p * 1e6;                     // kDAI — 1 kDAI = 1000 μDAI = 1e-6 DAI
  if (k < 1000) return (k < 10 ? String(Math.round(k * 10) / 10) : Math.round(k).toLocaleString()) + ' kDAI';
  if (p < 1)    return p.toPrecision(2) + ' DAI';
  return (p < 10 ? p.toFixed(2) : Math.round(p).toString()) + ' DAI';
};

function LogSlider({ value, onChange, disabled }) {
  const step = _daiToStep(value);
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
    onPanResponderGrant: (e) => { measureTrack(); onChange(_stepToDai(stepFromPageX(e.nativeEvent.pageX))); },
    onPanResponderMove:  (e) => onChange(_stepToDai(stepFromPageX(e.nativeEvent.pageX))),
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
  const [budget,     setBudget]     = useState(_pctToDai(0)); // default preset = 1 kDAI (1000 μDAI)
  // Fee currency — DAI (log slider) or a stablecoin (budget in display units,
  // converted to 2dp raw at submit). Miner receives exactly this currency.
  const [feeCurrency, setFeeCurrency] = useState('DAI');
  const [loading,    setLoading]    = useState(false);
  const [statusText, setStatusText] = useState('');
  // Messenger-style conversation: [{ id, role: 'user'|'ai', text?, error?, ...skill fields }]
  const [messages,   setMessages]   = useState([]);
  const [attachedFile, setAttachedFile] = useState(null); // { name, kind, content?|dataUrl?, mime?, size? }

  // Star-rating dialog: which message is being rated, and the draft comment.
  const [fbTarget,  setFbTarget]  = useState(null);
  const [fbStars,   setFbStars]   = useState(0);
  const [fbComment, setFbComment] = useState('');
  const [fbSending, setFbSending] = useState(false);
  const [fbError,   setFbError]   = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [historyBanner, setHistoryBanner] = useState(null);
  const [feeOpen, setFeeOpen] = useState(false);
  const suggestTimerRef = useRef(null);
  const scrollRef = useRef(null);
  const msgIdRef = useRef(0);

  const balance = selectedAddress ? (balances?.[selectedAddress] ?? 0) : 0;

  const pushMsg = (msg) => {
    const id = ++msgIdRef.current;
    setMessages(prev => [...prev, { id, ...msg }]);
    return id;
  };
  const patchMsg = (id, patch) =>
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));

  const scrollToEnd = () => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };
  useEffect(() => { scrollToEnd(); }, [messages, loading]);

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
      pushMsg({ role: 'user', text: q });
      pushMsg({ role: 'ai', type: 'chat', text: match.reply, fromChainHistory: true });
      setMessage('');
      setHistoryBanner(null);
      setSuggestions([]);
    }
  };

  // ── File attachment (text + images, 1 MB) ─────────────────────────────────
  const pickAttachment = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/*', 'image/*', 'application/json', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      if (file.size && file.size > MAX_ATTACH_BYTES) {
        Alert.alert('File too large', `Max 1 MB. "${file.name}" is ${(file.size / 1024).toFixed(0)} KB.`);
        return;
      }
      const mime = file.mimeType || '';
      const isImage = mime.startsWith('image/') || IMAGE_EXT_RE.test(file.name || '');
      const isText = mime.startsWith('text/') || /json|xml|javascript|yaml/.test(mime) || TEXT_EXT_RE.test(file.name || '');
      if (!isImage && !isText) {
        Alert.alert('Unsupported file', 'Attach text (txt/md/json/csv/code) or images (png/jpg/webp/gif).');
        return;
      }
      if (isImage) {
        const b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        const dataUrl = `data:${mime || 'image/png'};base64,${b64}`;
        setAttachedFile({ name: file.name, kind: 'image', mime: mime || 'image/png', dataUrl, size: file.size });
      } else {
        const content = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 });
        setAttachedFile({
          name: file.name, kind: 'text', mime: mime || 'text/plain',
          content: content.slice(0, 200_000), size: file.size,
        });
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not read that file.');
    }
  };

  const removeAttachment = () => setAttachedFile(null);

  function attachmentPayload(file) {
    if (!file) return null;
    if (file.kind === 'image' || file.dataUrl) {
      return [{ name: file.name, mime: file.mime, dataUrl: file.dataUrl }];
    }
    return [{ name: file.name, mime: file.mime || 'text/plain', content: file.content }];
  }

  // ── Node fetch ────────────────────────────────────────────────────────────
  async function askNode(q, { attachments, datasetId } = {}) {
    const candidates = [
      activeNodeUrl,
      ...nodes.map(n => n.url).filter(u => u !== activeNodeUrl),
    ].filter(Boolean);

    let lastErr = null;
    for (const url of candidates) {
      try {
        const base = url.replace(/\/$/, '');
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 120_000);
        let res;
        try {
          const body = {
            message: q || 'Please analyze the attached file(s).',
            walletAddress: selectedAddress,
            address: selectedAddress,
            requesterAddress: selectedAddress,
          };
          if (attachments?.length) body.attachments = attachments;
          if (datasetId) body.datasetId = datasetId;
          res = await fetch(`${base}/chat/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
        } finally { clearTimeout(timer); }

        const data = await res.json().catch(() => ({}));
        // 412 = dataset download required — surface to caller, not as a hard fail
        if (res.status === 412 && data.code === 'HF_DATASET_DOWNLOAD_REQUIRED') {
          return { data, base, datasetRequired: true };
        }
        if (!res.ok) {
          lastErr = data.error || `HTTP ${res.status}`;
          continue;
        }
        return { data, base };
      } catch (e) { lastErr = e.message; }
    }
    throw new Error(lastErr || 'All nodes unreachable for chat');
  }

  async function downloadDatasetOnNode(base, datasetId) {
    const r = await fetch(`${base}/api/hf-dataset/${encodeURIComponent(datasetId)}/download`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Dataset download failed (HTTP ${r.status})`);
    return d;
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const submitText = async (q, { attachments: atts } = {}) => {
    if (!q && !(atts?.length)) return;
    if (!activeNodeUrl) {
      pushMsg({ role: 'ai', error: true, text: 'No node connected. Check Settings.' });
      return;
    }

    setLoading(true);

    try {
      setStatusText(atts?.length ? 'Reading attachment…' : 'Thinking...');
      let { data: askData, base, datasetRequired } = await askNode(q, { attachments: atts });

      // Dataset approval loop (matches desktop HF_DATASET_DOWNLOAD_REQUIRED flow)
      if (datasetRequired && askData.datasetId) {
        const install = await new Promise((resolve) => {
          Alert.alert(
            'Dataset required',
            `Install "${askData.datasetId}" on this miner to answer?\n\n${askData.installInstructions || 'Stored under ~/.dai-miner/brain-data/hf-datasets/'}`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Download', onPress: () => resolve(true) },
            ],
          );
        });
        if (!install) {
          pushMsg({ role: 'ai', type: 'chat', text: `Download declined for \`${askData.datasetId}\`.` });
          setStatusText('');
          return;
        }
        setStatusText(`Downloading ${askData.datasetId}…`);
        await downloadDatasetOnNode(base, askData.datasetId);
        setStatusText('Answering with dataset…');
        ({ data: askData, base } = await askNode(q, { attachments: atts, datasetId: askData.datasetId }));
      }

      // Free chat / cascade / inline skill / hf-model all return type:'chat' with a message
      if (askData.type === 'chat' || askData.message || askData.reply) {
        const label = askData.cascade || askData.tasks
          ? 'AI · task cascade'
          : askData.skill
            ? `AI · ${askData.skill}`
            : askData.fromChainHistory
              ? 'AI · from chain history'
              : 'AI';
        pushMsg({
          role: 'ai', type: 'chat',
          text: askData.message || askData.reply || '(no response)',
          fromChainHistory: !!askData.fromChainHistory,
          cascade: !!(askData.cascade || askData.tasks),
          skill: askData.skill,
          headerLabel: label,
        });
        setSuggestions([]);
        setHistoryBanner(null);
        setStatusText('');
        return;
      }

      // Skill path — budget converts at the fee currency's own decimals
      const feeDecimals = feeCurrency === 'DAI' ? 1_000_000_000 : 100;
      const maxBudget = Math.max(feeCurrency === 'DAI' ? 0 : 1, Math.round(budget * feeDecimals));
      if (!(maxBudget > 0)) {
        setFeeOpen(true);
        Alert.alert('Fee Required', 'This question needs a real-time data skill. Set a fee using the slider and try again.');
        return;
      }
      if (!selectedAddress) { pushMsg({ role: 'ai', error: true, text: 'Select a wallet to pay the skill fee.' }); return; }
      if (feeCurrency === 'DAI' && budget > balance) { pushMsg({ role: 'ai', error: true, text: `Insufficient balance: ${balance.toFixed(2)} DAI available.` }); return; }

      // Fee-required job types need a signed payment proof (paymentTx) bound to
      // jobId + miner + amount + nonce — the node rejects them with 402 otherwise.
      setStatusText('Signing fee payment...');
      const privateKeyHex = getPrivateKey ? await getPrivateKey(selectedAddress) : null;
      if (!privateKeyHex) { pushMsg({ role: 'ai', error: true, text: 'Private key not found for this wallet.' }); return; }
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
        currency: feeCurrency,
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
          maxBudget, currency: feeCurrency, requesterAddress: selectedAddress,
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
      pushMsg({
        role: 'ai', type: 'skill', skillId: askData.skillId,
        jobId:      rData?.jobId || jobId,
        output:     rData?.profile?.skillOutput ?? rData,
        text:       rData?.profile?.nlResponse || null,
        tokensUsed: rData?.profile?.tokensUsed,
        feedback:   null,
      });
      setStatusText('');
    } catch (err) {
      pushMsg({ role: 'ai', error: true, text: err.message || 'Something went wrong.' });
      setStatusText('');
    } finally {
      setLoading(false);
    }
  };

  const submit = () => {
    const text = message.trim();
    if (!text && !attachedFile) return;
    const atts = attachmentPayload(attachedFile);
    // Text-only attachments still get a readable prompt; images rely on structured attachments
    let q = text;
    if (attachedFile?.kind === 'text' && attachedFile.content) {
      q = `${text}\n\n[Attached file: ${attachedFile.name}]\n\`\`\`\n${attachedFile.content}\n\`\`\``;
    } else if (!q && attachedFile) {
      q = 'Please analyze the attached file(s).';
    }
    const icon = attachedFile?.kind === 'image' ? '🖼️' : '📎';
    pushMsg({
      role: 'user',
      text: text || `${icon} ${attachedFile?.name}`,
      attachment: attachedFile?.name || null,
    });
    setMessage('');
    setSuggestions([]);
    setHistoryBanner(null);
    submitText(q, { attachments: atts });
    setAttachedFile(null);
  };

  const copyMessage = async (msg) => {
    const text = msg.text
      || (typeof msg.output === 'string' ? msg.output : JSON.stringify(msg.output, null, 2));
    if (!text) return;
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Response copied to clipboard');
  };

  // Tapping a star opens the dialog rather than submitting straight away, so the
  // user can say why. `comment` is capped at FEEDBACK_COMMENT_MAX, matching the
  // node's own limit on POST /api/jobs/:id/feedback.
  const openFeedback = (msg, stars) => {
    if (!msg.jobId || msg.feedback) return;
    setFbTarget(msg);
    setFbStars(stars);
    setFbComment('');
    setFbError('');
    setFbSending(false);
  };

  const closeFeedback = () => { if (!fbSending) setFbTarget(null); };

  const submitFeedback = async () => {
    if (!fbTarget || fbSending) return;
    setFbSending(true);
    setFbError('');
    try {
      const res = await fetch(`${activeNodeUrl.replace(/\/$/, '')}/api/jobs/${fbTarget.jobId}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stars: fbStars,
          comment: fbComment.trim().slice(0, FEEDBACK_COMMENT_MAX),
          requesterAddress: selectedAddress,
        }),
      });
      if (!res.ok) {
        let m = `Request failed (${res.status})`;
        try { const j = await res.json(); if (j?.error) m = j.error; } catch {}
        setFbError(m);
        setFbSending(false);
        return;
      }
      patchMsg(fbTarget.id, { feedback: fbStars });
      setFbTarget(null);
      setFbSending(false);
    } catch (e) {
      setFbError(e.message || 'Could not submit feedback.');
      setFbSending(false);
    }
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

  const renderAiBubble = (msg) => {
    if (msg.error) {
      return (
        <View key={msg.id} style={[s.bubbleRow, s.bubbleRowAi]}>
          <View style={[s.bubble, s.bubbleError]}>
            <Text style={s.errorText}>{msg.text}</Text>
          </View>
        </View>
      );
    }
    const isSkill = msg.type === 'skill';
    return (
      <View key={msg.id} style={[s.bubbleRow, s.bubbleRowAi]}>
        <View style={[s.bubble, s.bubbleAi]}>
          <View style={s.bubbleHeaderRow}>
            <Text style={s.bubbleHeader}>
              {isSkill
                ? `${msg.skillId}${msg.tokensUsed ? `  ·  ${msg.tokensUsed} tokens` : ''}`
                : msg.headerLabel
                  || (msg.cascade ? 'AI · task cascade' : null)
                  || (msg.skill ? `AI · ${msg.skill}` : null)
                  || (msg.fromChainHistory ? 'AI · from chain history' : 'AI')}
            </Text>
            <TouchableOpacity style={s.copyBtn} onPress={() => copyMessage(msg)}>
              <Text style={s.copyBtnText}>⎘</Text>
            </TouchableOpacity>
          </View>

          {msg.text ? renderMarkdown(msg.text) : renderSkillOutput(msg.output)}

          {isSkill && (
            msg.feedback ? (
              <Text style={s.feedbackDone}>
                Thanks! {'★'.repeat(msg.feedback)}{'☆'.repeat(5 - msg.feedback)}
              </Text>
            ) : (
              <View style={s.feedbackRow}>
                <Text style={s.feedbackLabel}>Rate this:</Text>
                {[1, 2, 3, 4, 5].map(n => (
                  <TouchableOpacity key={n} style={s.starBtn} onPress={() => openFeedback(msg, n)}>
                    <Text style={s.starBtnText}>★</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )
          )}
        </View>
      </View>
    );
  };

  const canSend = !loading && (message.trim() || attachedFile);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#000' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* ── Conversation ── */}
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={s.chatContent}
        onContentSizeChange={scrollToEnd}
      >
        {messages.length === 0 && !loading ? (
          <View style={s.emptyState}>
            <Text style={s.emptyTitle}>Ask the network anything</Text>
            <Text style={s.emptyHint}>
              Answers come from AI miners on the DAI network.{'\n'}
              Real-time data skills charge the fee you set below.
            </Text>
          </View>
        ) : null}

        {messages.map(msg =>
          msg.role === 'user' ? (
            <View key={msg.id} style={[s.bubbleRow, s.bubbleRowUser]}>
              <View style={[s.bubble, s.bubbleUser]}>
                {msg.attachment ? (
                  <Text style={s.bubbleAttach}>📎 {msg.attachment}</Text>
                ) : null}
                <Text style={s.bubbleUserText}>{msg.text}</Text>
              </View>
            </View>
          ) : renderAiBubble(msg)
        )}

        {loading ? (
          <View style={[s.bubbleRow, s.bubbleRowAi]}>
            <View style={[s.bubble, s.bubbleAi, s.bubbleTyping]}>
              <ActivityIndicator color="#22c55e" size="small" />
              <Text style={s.typingText}>{statusText || 'Thinking...'}</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* ── Composer ── */}
      <View style={s.composer}>
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

        {attachedFile ? (
          <View style={s.attachChipRow}>
            <View style={s.attachChip}>
              <Text style={s.attachChipText} numberOfLines={1}>
                {attachedFile.kind === 'image' ? '🖼️ ' : '📎 '}
                {attachedFile.name}
                {attachedFile.size ? ` (${Math.max(1, Math.round(attachedFile.size / 1024))} KB)` : ''}
              </Text>
              <TouchableOpacity onPress={removeAttachment}>
                <Text style={s.attachChipRemove}>×</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {feeOpen ? (
          <View style={s.feePanel}>
            <View style={s.feeRow}>
              <Text style={s.label}>MAX FEE <Text style={s.labelNote}>(data skills only)</Text></Text>
              <Text style={s.feeValue}>{feeCurrency === 'DAI' ? _fmtDai(budget) : `${budget.toFixed(2)} ${assetMeta(feeCurrency).display}`}</Text>
            </View>
            {/* Fee currency chips — the miner receives exactly this currency */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {['DAI', ...STABLE_TICKERS].map(tk => (
                <TouchableOpacity
                  key={tk}
                  onPress={() => { setFeeCurrency(tk); if (tk !== 'DAI' && budget < 0.01) setBudget(0.01); }}
                  style={{
                    paddingVertical: 3, paddingHorizontal: 9, borderRadius: 11, borderWidth: 1,
                    borderColor: feeCurrency === tk ? '#22c55e' : '#1f2937',
                    backgroundColor: feeCurrency === tk ? '#052e16' : 'transparent',
                  }}>
                  <Text style={{ color: feeCurrency === tk ? '#22c55e' : '#6b7280', fontSize: 10 }}>
                    {assetMeta(tk).display}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <LogSlider value={budget} onChange={setBudget} disabled={loading} />
            <View style={s.presetRow}>
              {FEE_PRESETS.map(p => {
                const pv = _pctToDai(p.pct);
                const active = Math.abs(_daiToStep(budget) - _daiToStep(pv)) <= 1;
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
              Balance: {balance.toFixed(2)} DAI · fee only charged when a data skill is used
            </Text>
          </View>
        ) : null}

        <View style={s.inputRow}>
          <TouchableOpacity style={s.roundBtn} onPress={pickAttachment} disabled={loading}>
            <Text style={s.roundBtnText}>📎</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.roundBtn, feeOpen && s.roundBtnActive]}
            onPress={() => setFeeOpen(o => !o)}
          >
            <Text style={[s.roundBtnText, { fontSize: 11, color: feeOpen ? '#22c55e' : '#6b7280' }]}>
              {feeCurrency === 'DAI' ? _fmtDai(budget) : `${budget.toFixed(2)} ${assetMeta(feeCurrency).display}`}
            </Text>
          </TouchableOpacity>
          <TextInput
            style={s.input}
            placeholder="Ask the network anything…"
            placeholderTextColor="#4b5563"
            value={message}
            onChangeText={setMessage}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />
          <TouchableOpacity
            style={[s.sendBtn, !canSend && s.sendBtnDisabled]}
            onPress={submit}
            disabled={!canSend}
          >
            {loading ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={s.sendBtnText}>➤</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
      {/* ── Star-rating feedback dialog ─────────────────────────────────── */}
      <Modal visible={!!fbTarget} transparent animationType="fade" onRequestClose={closeFeedback}>
        <View style={s.fbOverlay}>
          <View style={s.fbCard}>
            <Text style={s.fbTitle}>Rate this answer</Text>
            <Text style={s.fbSub}>Your rating and comment train the node's brain and shape later replies.</Text>

            <View style={s.fbStars}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => setFbStars(n)} style={s.fbStarBtn}>
                  <Text style={[s.fbStar, n <= fbStars && s.fbStarOn]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={s.fbInput}
              value={fbComment}
              onChangeText={t => setFbComment(t.slice(0, FEEDBACK_COMMENT_MAX))}
              maxLength={FEEDBACK_COMMENT_MAX}
              placeholder="What was good or wrong about it? (optional)"
              placeholderTextColor="#4b5563"
              multiline
              textAlignVertical="top"
              editable={!fbSending}
            />
            <Text style={[s.fbCount, fbComment.length >= FEEDBACK_COMMENT_MAX && s.fbCountLimit]}>
              {fbComment.length}/{FEEDBACK_COMMENT_MAX}
            </Text>

            {fbError ? <Text style={s.fbError}>{fbError}</Text> : null}

            <View style={s.fbActions}>
              <TouchableOpacity style={s.fbBtn} onPress={closeFeedback} disabled={fbSending}>
                <Text style={s.fbBtnText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.fbBtn, s.fbBtnPrimary, fbSending && s.fbBtnDisabled]}
                onPress={submitFeedback}
                disabled={fbSending}
              >
                {fbSending
                  ? <ActivityIndicator size="small" color="#04140a" />
                  : <Text style={[s.fbBtnText, s.fbBtnPrimaryText]}>Submit</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  chatContent: { padding: 12, paddingBottom: 16, flexGrow: 1 },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 80 },
  emptyTitle: { color: '#22c55e', fontSize: 20, fontFamily: 'Iceland_400Regular', lineHeight: 29, letterSpacing: 1, marginBottom: 8 },
  emptyHint:  { color: '#4b5563', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 19, textAlign: 'center' },

  // Bubbles
  bubbleRow:     { flexDirection: 'row', marginBottom: 10 },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAi:   { justifyContent: 'flex-start' },
  bubble:        { maxWidth: '88%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleUser:    { backgroundColor: '#14331d', borderWidth: 1, borderColor: '#1e4d2b', borderBottomRightRadius: 4 },
  bubbleUserText:{ color: '#e5e7eb', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 21 },
  bubbleAttach:  { color: '#22c55e', fontSize: 12, fontFamily: 'monospace', marginBottom: 4 },
  bubbleAi:      { backgroundColor: '#0d0d0d', borderWidth: 1, borderColor: '#1f2f1f', borderBottomLeftRadius: 4 },
  bubbleError:   { backgroundColor: '#1c0a0a', borderWidth: 1, borderColor: '#ef4444', borderBottomLeftRadius: 4 },
  bubbleTyping:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typingText:    { color: '#6b7280', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 19 },

  bubbleHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  bubbleHeader:    { color: '#22c55e', fontSize: 12, fontFamily: 'Iceland_400Regular', lineHeight: 17, letterSpacing: 1, flex: 1 },
  copyBtn:         { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#2a2a2a', marginLeft: 8 },
  copyBtnText:     { color: '#6b7280', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 18 },

  errorText: { color: '#ef4444', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 20 },

  // Composer
  composer: { borderTopWidth: 1, borderTopColor: '#161616', backgroundColor: '#050505', padding: 10, paddingBottom: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  input: {
    flex: 1, backgroundColor: '#0d0d0d', color: '#fff',
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: 18, fontSize: 13,
    fontFamily: 'Iceland_400Regular', lineHeight: 19, borderWidth: 1, borderColor: '#222',
    maxHeight: 110, minHeight: 38, textAlignVertical: 'center',
  },
  roundBtn:      { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: '#222', backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center' },
  roundBtnActive:{ borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)' },
  roundBtnText:  { fontSize: 15, color: '#9ca3af' },
  sendBtn:         { width: 38, height: 38, borderRadius: 19, backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#166534', opacity: 0.6 },
  sendBtnText:     { color: '#000', fontSize: 16, fontWeight: '700' },

  // Fee panel (collapsible)
  feePanel:  { marginBottom: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#1a1a1a', backgroundColor: '#0a0a0a' },
  label:     { color: '#4b5563', fontSize: 13, letterSpacing: 1.5, fontFamily: 'Iceland_400Regular', lineHeight: 19 },
  labelNote: { color: '#374151', letterSpacing: 0, textTransform: 'none' },
  feeRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  feeValue:  { color: '#22c55e', fontSize: 15, fontFamily: 'Iceland_400Regular', lineHeight: 22 },
  feeNote:   { color: '#374151', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 19, marginTop: 6 },
  presetRow:      { flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: 8 },
  presetBtn:      { flex: 1, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#1f2937', alignItems: 'center', backgroundColor: '#0a0a0a' },
  presetBtnActive:{ borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)' },
  presetText:     { color: '#6b7280', fontSize: 12, letterSpacing: 1, fontFamily: 'Iceland_400Regular', lineHeight: 17 },
  presetTextActive:{ color: '#22c55e' },

  suggestBox: {
    backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#222',
    marginBottom: 8, overflow: 'hidden',
  },
  suggestItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  suggestPrompt: { color: '#d1d5db', fontSize: 13, fontFamily: 'Iceland_400Regular', lineHeight: 18 },
  suggestReply: { color: '#6b7280', fontSize: 11, fontStyle: 'italic', marginTop: 2, fontFamily: 'Iceland_400Regular', lineHeight: 16 },
  suggestBadge: { color: '#22c55e', fontSize: 10, fontFamily: 'monospace', marginTop: 3 },

  historyBanner: {
    backgroundColor: '#0f1f14', borderRadius: 8, padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: '#1e3a2a',
  },
  historyBannerLabel: { color: '#4ade80', fontSize: 11, fontFamily: 'Iceland_400Regular', lineHeight: 16, marginBottom: 4 },
  historyBannerReply: { color: '#9ca3af', fontSize: 12, fontStyle: 'italic', fontFamily: 'Iceland_400Regular', lineHeight: 17, marginBottom: 8 },
  historyBannerBtn: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, borderWidth: 1, borderColor: '#22c55e', backgroundColor: '#166534' },
  historyBannerBtnText: { color: '#22c55e', fontSize: 11, fontFamily: 'monospace' },

  attachChipRow:   { flexDirection: 'row', marginBottom: 8 },
  attachChip:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', maxWidth: 220 },
  attachChipText:  { color: '#22c55e', fontSize: 12, fontFamily: 'monospace', flexShrink: 1 },
  attachChipRemove: { color: '#f87171', fontSize: 16, fontWeight: '700', paddingHorizontal: 2 },

  // Markdown styles
  resultText:  { color: '#e5e7eb', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 22 },
  mdH1:        { color: '#fff', fontSize: 20, fontWeight: '700', fontFamily: 'Iceland_400Regular', lineHeight: 29, marginTop: 12, marginBottom: 6 },
  mdH2:        { color: '#fff', fontSize: 17, fontWeight: '700', fontFamily: 'Iceland_400Regular', lineHeight: 25, marginTop: 10, marginBottom: 4 },
  mdH3:        { color: '#22c55e', fontSize: 15, fontWeight: '700', fontFamily: 'Iceland_400Regular', lineHeight: 22, marginTop: 8, marginBottom: 4, letterSpacing: 0.5 },
  mdBullet:    { color: '#e5e7eb', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 22, marginBottom: 2, paddingLeft: 4 },
  mdRule:      { height: 1, backgroundColor: '#222', marginVertical: 10 },
  inlineCode:  { fontFamily: 'monospace', backgroundColor: '#1a1a1a', color: '#22c55e', borderRadius: 3, paddingHorizontal: 3 },
  codeBlock:   { backgroundColor: '#161616', borderRadius: 8, padding: 12, marginVertical: 8, borderWidth: 1, borderColor: '#222' },
  codeText:    { color: '#9ca3af', fontSize: 13, fontFamily: 'monospace', lineHeight: 18 },

  postRow:     { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  postTitle:   { color: '#fff', fontSize: 15, fontFamily: 'Iceland_400Regular', lineHeight: 22, marginBottom: 4 },

  feedbackRow:  { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 4 },
  feedbackLabel: { color: '#4b5563', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 20, marginRight: 4 },
  starBtn:      { padding: 2 },

  // Star-rating dialog
  fbOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  fbCard:        { width: '100%', maxWidth: 420, backgroundColor: '#0d0d0d', borderWidth: 1, borderColor: '#262626', borderRadius: 12, padding: 18 },
  fbTitle:       { color: '#e5e7eb', fontSize: 15, fontWeight: '600' },
  fbSub:         { color: '#6b7280', fontSize: 11, marginTop: 3, marginBottom: 12 },
  fbStars:       { flexDirection: 'row', gap: 6, marginBottom: 12 },
  fbStarBtn:     { padding: 2 },
  fbStar:        { fontSize: 26, color: '#2a2a2a' },
  fbStarOn:      { color: '#facc15' },
  fbInput:       { minHeight: 88, backgroundColor: '#070707', borderWidth: 1, borderColor: '#232323', borderRadius: 8, color: '#e5e7eb', fontSize: 13, padding: 10 },
  fbCount:       { color: '#6b7280', fontSize: 10, textAlign: 'right', marginTop: 4 },
  fbCountLimit:  { color: '#f59e0b' },
  fbError:       { color: '#ef4444', fontSize: 11, marginTop: 8 },
  fbActions:     { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  fbBtn:         { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#141414', minWidth: 84, alignItems: 'center' },
  fbBtnText:     { color: '#9ca3af', fontSize: 13 },
  fbBtnPrimary:  { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  fbBtnPrimaryText: { color: '#04140a', fontWeight: '700' },
  fbBtnDisabled: { opacity: 0.7 },
  starBtnText:  { fontSize: 20, color: '#374151' },
  feedbackDone: { color: '#6b7280', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 20, marginTop: 10 },
});
