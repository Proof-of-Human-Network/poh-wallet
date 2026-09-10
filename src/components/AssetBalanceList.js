/**
 * Stablecoin holdings, rendered the way the currency picker renders currencies.
 *
 * The old list was a ticker and a number: "αιBTN   15555540.00 Nu.". At 14
 * holdings you could learn the tickers; at 161 you cannot, and a column of
 * greek-prefixed codes tells you nothing about what you hold. Each row now
 * carries the same two lines the picker uses — display ticker above, currency
 * name and country below — so the two screens read as one product.
 *
 * Amounts are right-aligned and monospaced-by-position so the decimal points
 * line up down the column, which is the whole reason a balance list is a
 * column rather than prose.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ASSETS, assetMeta } from '../constants/assets';

/** Group separators make a 9-digit balance readable at a glance. */
function formatAmount(value, decimals = 2) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function subtitleFor(ticker) {
  const a = ASSETS[ticker];
  if (!a) return '';
  return [a.name, a.country].filter(Boolean).join(' · ');
}

export default function AssetBalanceList({ balances = {}, onPressAsset = null, emptyLabel = null }) {
  // Non-zero only, biggest first — a balance list is a list of what you have.
  const rows = useMemo(() => (
    Object.entries(balances || {})
      .filter(([, v]) => Number(v) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
  ), [balances]);

  if (!rows.length) {
    return emptyLabel ? <Text style={s.empty}>{emptyLabel}</Text> : null;
  }

  return (
    <View style={s.wrap}>
      {rows.map(([ticker, value]) => {
        const meta = assetMeta(ticker);
        const sub = subtitleFor(ticker);
        const Row = onPressAsset ? TouchableOpacity : View;
        return (
          <Row
            key={ticker}
            style={s.row}
            {...(onPressAsset ? { onPress: () => onPressAsset(ticker) } : {})}
          >
            <View style={s.left}>
              <Text style={s.ticker} numberOfLines={1}>{meta.display}</Text>
              {sub ? <Text style={s.sub} numberOfLines={1}>{sub}</Text> : null}
            </View>
            <View style={s.right}>
              <Text style={s.amount} numberOfLines={1}>{formatAmount(value, meta.decimals)}</Text>
              {/* RTL signs (ع.د, ل.د, ﷼) must not reorder the amount beside them. */}
              {meta.sign ? <Text style={s.sign} numberOfLines={1}>{meta.sign}</Text> : null}
            </View>
          </Row>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#141414',
  },
  left: { flex: 1, paddingRight: 10 },
  ticker: { color: '#e5e7eb', fontSize: 14, fontFamily: 'Iceland_400Regular', lineHeight: 18 },
  sub: { color: '#6b7280', fontSize: 11, fontFamily: 'Iceland_400Regular', writingDirection: 'ltr' },
  right: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  amount: { color: '#e5e7eb', fontSize: 14, fontFamily: 'Iceland_400Regular', fontVariant: ['tabular-nums'] },
  sign: { color: '#6b7280', fontSize: 12, fontFamily: 'Iceland_400Regular', writingDirection: 'ltr', minWidth: 26 },
  empty: { color: '#4b5563', fontSize: 12, fontFamily: 'Iceland_400Regular', marginTop: 8 },
});
