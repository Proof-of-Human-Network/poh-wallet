/**
 * Stablecoin holdings — searchable, paged, and rendered the way the currency
 * picker renders currencies.
 *
 * Two problems at 161 currencies. A wallet can hold well over a hundred, so the
 * card cannot render them all; and a column of greek-prefixed codes tells you
 * nothing about what you hold. So each row carries the same two lines the
 * picker uses — display ticker above, currency name and country below — and the
 * list pages ten at a time behind a search box.
 *
 * Amounts are right-aligned with tabular figures so the decimal points line up
 * down the column, which is the whole reason a balance list is a column.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { ASSETS, assetMeta } from '../constants/assets';

export const PER_PAGE = 10;
const DEBOUNCE_MS = 120;

function formatAmount(value, decimals = 2) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function subtitleFor(ticker) {
  const a = ASSETS[ticker];
  if (!a) return '';
  return [a.name, a.country].filter(Boolean).join(' · ');
}

/**
 * Balance map -> displayable rows: non-zero only, largest first, each with a
 * lowercase haystack so search never rebuilds strings per keystroke.
 */
export function buildAssetRows(balances = {}) {
  return Object.entries(balances || {})
    .filter(([, v]) => Number(v) > 0)
    .map(([ticker, value]) => {
      const meta = assetMeta(ticker);
      const sub = subtitleFor(ticker);
      return {
        ticker,
        value: Number(value),
        meta,
        sub,
        // ticker, ISO, name and country all match, so "bhu", "BTN",
        // "ngultrum" and "Bhutan" all find the same row.
        haystack: [ticker, meta.display, ASSETS[ticker]?.iso, sub].filter(Boolean).join(' ').toLowerCase(),
      };
    })
    .sort((a, b) => b.value - a.value);
}

/** Clamp a page index and slice it. Past-the-end lands on the last page, never blank. */
export function pageOf(rows, page, perPage = PER_PAGE) {
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const from = safePage * perPage;
  return { pages, safePage, from, slice: rows.slice(from, from + perPage) };
}

function formatConverted(value, currency) {
  try {
    return value.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 2 });
  } catch {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
  }
}

export default function AssetBalanceList({
  balances = {},
  onPressAsset = null,
  emptyLabel = null,
  converted = null,
  displayCurrency = 'USD',
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);

  // Non-zero only, biggest first, with the search haystack built once per
  // balance change rather than per keystroke.
  const rows = useMemo(() => buildAssetRows(balances), [balances]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const filtered = useMemo(
    () => (debounced ? rows.filter(r => r.haystack.includes(debounced)) : rows),
    [rows, debounced],
  );

  // A new query starts at the first page; keeping the offset renders blank.
  useEffect(() => { setPage(0); }, [debounced]);

  const { pages, safePage, from, slice } = pageOf(filtered, page);

  if (!rows.length) {
    return emptyLabel ? <Text style={s.empty}>{emptyLabel}</Text> : null;
  }

  return (
    <View style={s.wrap}>
      {/* The search box is noise until there is more than a page to search. */}
      {rows.length > PER_PAGE && (
        <TextInput
          style={s.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search your coins"
          placeholderTextColor="#4b5563"
          autoCorrect={false}
          autoCapitalize="none"
        />
      )}

      {slice.map(r => {
        const Row = onPressAsset ? TouchableOpacity : View;
        const conv = converted && converted[r.ticker];
        return (
          <Row
            key={r.ticker}
            style={s.row}
            {...(onPressAsset ? { onPress: () => onPressAsset(r.ticker) } : {})}
          >
            <View style={s.left}>
              <Text style={s.ticker} numberOfLines={1}>{r.meta.display}</Text>
              {r.sub ? <Text style={s.sub} numberOfLines={1}>{r.sub}</Text> : null}
            </View>
            <View style={s.rightCol}>
              {conv > 0 ? (
                <Text style={s.converted} numberOfLines={1}>{formatConverted(conv, displayCurrency)}</Text>
              ) : null}
              <View style={s.right}>
                <Text style={s.amount} numberOfLines={1}>{formatAmount(r.value, r.meta.decimals)}</Text>
                {/* RTL signs (ع.د, ل.د, ﷼) must not reorder the amount beside them. */}
                {r.meta.sign ? <Text style={s.sign} numberOfLines={1}>{r.meta.sign}</Text> : null}
              </View>
            </View>
          </Row>
        );
      })}

      {!filtered.length && <Text style={s.empty}>No coin matches “{query}”.</Text>}

      {filtered.length > PER_PAGE && (
        <View style={s.pager}>
          <TouchableOpacity
            disabled={safePage === 0}
            onPress={() => setPage(p => Math.max(0, p - 1))}
            style={[s.pageBtn, safePage === 0 && s.pageBtnOff]}
          >
            <Text style={s.pageBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={s.pageCount}>
            {from + 1}–{Math.min(from + PER_PAGE, filtered.length)} of {filtered.length}
          </Text>
          <TouchableOpacity
            disabled={safePage >= pages - 1}
            onPress={() => setPage(p => Math.min(pages - 1, p + 1))}
            style={[s.pageBtn, safePage >= pages - 1 && s.pageBtnOff]}
          >
            <Text style={s.pageBtnText}>→</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 8 },
  search: {
    height: 32, borderRadius: 8, borderWidth: 1, borderColor: '#1f2937',
    paddingHorizontal: 10, marginBottom: 6,
    color: '#e5e7eb', fontSize: 12, fontFamily: 'Iceland_400Regular',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#141414',
  },
  left: { flex: 1, paddingRight: 10 },
  ticker: { color: '#e5e7eb', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 18 },
  sub: { color: '#6b7280', fontSize: 11, fontFamily: 'Iceland_400Regular', writingDirection: 'ltr' },
  rightCol: { alignItems: 'flex-end' },
  converted: { color: '#fff', fontSize: 18, fontFamily: 'Iceland_400Regular', fontVariant: ['tabular-nums'], lineHeight: 24 },
  right: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  amount: { color: '#9ca3af', fontSize: 12, fontFamily: 'Iceland_400Regular', fontVariant: ['tabular-nums'] },
  sign: { color: '#6b7280', fontSize: 12, fontFamily: 'Iceland_400Regular', writingDirection: 'ltr', minWidth: 26 },
  empty: { color: '#4b5563', fontSize: 12, fontFamily: 'Iceland_400Regular', marginTop: 8 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  pageBtn: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#1f2937' },
  pageBtnOff: { opacity: 0.35 },
  pageBtnText: { color: '#9ca3af', fontSize: 13, fontFamily: 'Iceland_400Regular' },
  pageCount: { color: '#6b7280', fontSize: 11, fontFamily: 'Iceland_400Regular' },
});
