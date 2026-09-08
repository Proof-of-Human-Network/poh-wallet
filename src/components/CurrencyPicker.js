/**
 * Searchable currency picker.
 *
 * At 15 currencies a horizontal strip of pills was fine. At 153 it is a scroll
 * bar you drag through, with no way to find Bhutan without already knowing it
 * is aiBTN — so selection moves into a modal with a search field.
 *
 * Built to survive the list growing: rows have a fixed height and supply
 * getItemLayout (without it FlatList measures all 153 and the batching wins
 * nothing), the query is debounced, and matching runs over a lowercase haystack
 * built once at module load rather than per keystroke.
 *
 * Shared by the P2P filter and the order-creation base/quote selectors.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Modal,
  TextInput, Platform,
} from 'react-native';
import { ASSETS, ONCHAIN_ASSETS } from '../constants/assets';

export const ALL = 'All';
const ROW_H = 56;
const DEBOUNCE_MS = 120;

/** Off-chain quote currencies — payment rails, not on-chain assets. */
export const OFFCHAIN_QUOTES = [
  'USDT-ERC20', 'USDT-TRC20', 'USDT-TON', 'USDT-SOL', 'USDT-BEP20',
  'USDC-ERC20', 'BTC', 'ETH', 'SOL', 'Bank Transfer',
];

/**
 * One row per selectable currency, with its search haystack precomputed.
 * Module-level: this is stable for the life of the app.
 */
function buildRows(codes) {
  return codes.map(code => {
    const a = ASSETS[code];
    const title = a?.display || code;
    const subtitle = a ? [a.name, a.country].filter(Boolean).join(' · ') : 'Payment method';
    return {
      code,
      title,
      subtitle,
      // ticker, ISO, name and country all match, so "bhu", "BTN", "ngultrum"
      // and "Bhutan" all land on aiBTN.
      haystack: [code, title, a?.iso, a?.name, a?.country, subtitle]
        .filter(Boolean).join(' ').toLowerCase(),
    };
  });
}

const DEFAULT_CODES = [...ONCHAIN_ASSETS.filter(c => c !== 'DAI'), ...OFFCHAIN_QUOTES];
const DEFAULT_ROWS = buildRows(DEFAULT_CODES);

export default function CurrencyPicker({
  value,
  onChange,
  codes = null,
  includeAll = true,
  allLabel = 'All currencies',
  label = null,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const listRef = useRef(null);

  const rows = useMemo(() => (codes ? buildRows(codes) : DEFAULT_ROWS), [codes]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const data = useMemo(() => {
    const matched = debounced
      ? rows.filter(r => r.haystack.includes(debounced))
      : rows;
    return includeAll && !debounced
      ? [{ code: ALL, title: allLabel, subtitle: 'No filter', haystack: '' }, ...matched]
      : matched;
  }, [rows, debounced, includeAll, allLabel]);

  // A stale scroll offset on a shorter list shows an empty view.
  useEffect(() => {
    listRef.current?.scrollToOffset?.({ offset: 0, animated: false });
  }, [debounced]);

  const close = useCallback(() => { setOpen(false); setQuery(''); setDebounced(''); }, []);
  const pick = useCallback(code => { onChange?.(code); close(); }, [onChange, close]);

  const selected = value === ALL || !value
    ? allLabel
    : (ASSETS[value]?.display || value);

  const getItemLayout = useCallback(
    (_, index) => ({ length: ROW_H, offset: ROW_H * index, index }),
    [],
  );

  const renderItem = useCallback(({ item }) => (
    <TouchableOpacity
      style={[s.row, item.code === value && s.rowActive]}
      onPress={() => pick(item.code)}
    >
      <Text style={[s.rowTitle, item.code === value && s.rowTitleActive]} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={s.rowSub} numberOfLines={1}>{item.subtitle}</Text>
    </TouchableOpacity>
  ), [pick, value]);

  return (
    <>
      <TouchableOpacity style={s.trigger} onPress={() => setOpen(true)}>
        {label ? <Text style={s.triggerLabel}>{label}</Text> : null}
        <Text style={s.triggerText} numberOfLines={1}>{selected}</Text>
        <Text style={s.triggerChevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" onRequestClose={close} transparent={false}>
        <View style={s.modal}>
          <View style={s.searchRow}>
            <TextInput
              style={s.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search currency, code or country"
              placeholderTextColor="#666"
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            <TouchableOpacity onPress={close} style={s.cancel}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            ref={listRef}
            data={data}
            keyExtractor={r => r.code}
            renderItem={renderItem}
            getItemLayout={getItemLayout}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={5}
            removeClippedSubviews={Platform.OS === 'android'}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={s.empty}>No currency matches “{query}”.</Text>}
          />
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 14, borderWidth: 1, borderColor: '#333',
    paddingHorizontal: 12, paddingVertical: 7, marginBottom: 8, alignSelf: 'flex-start',
  },
  triggerLabel: { color: '#666', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  triggerText: { color: '#22c55e', fontSize: 15, fontFamily: 'Iceland_400Regular', lineHeight: 20 },
  triggerChevron: { color: '#666', fontSize: 12 },

  modal: { flex: 1, backgroundColor: '#0a0a0a', paddingTop: Platform.OS === 'ios' ? 56 : 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  search: {
    flex: 1, height: 42, borderRadius: 10, borderWidth: 1, borderColor: '#333',
    paddingHorizontal: 12, color: '#eee', fontSize: 15, fontFamily: 'Iceland_400Regular',
  },
  cancel: { paddingHorizontal: 6, paddingVertical: 8 },
  cancelText: { color: '#888', fontSize: 15, fontFamily: 'Iceland_400Regular' },

  row: { height: ROW_H, justifyContent: 'center', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#161616' },
  rowActive: { backgroundColor: '#052e16' },
  rowTitle: { color: '#eee', fontSize: 16, fontFamily: 'Iceland_400Regular', lineHeight: 21 },
  rowTitleActive: { color: '#22c55e' },
  // RTL signs (ع.د, ل.د, ﷼) would otherwise reorder the rest of the line.
  rowSub: { color: '#777', fontSize: 13, fontFamily: 'Iceland_400Regular', writingDirection: 'ltr' },
  empty: { color: '#666', textAlign: 'center', marginTop: 32, fontFamily: 'Iceland_400Regular' },
});
