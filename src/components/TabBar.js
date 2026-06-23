import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

const TABS = [
  { key: 'home', labelKey: 'tab.home' },
  { key: 'history', labelKey: 'tab.history' },
  { key: 'p2p', label: 'P2P' },
  { key: 'search', label: 'AI' },
  { key: 'wallets', labelKey: 'tab.wallets' },
];

export default function TabBar({ currentScreen, onTabPress, t }) {
  return (
    <View style={styles.tabBar}>
      {TABS.map(tab => {
        const isActive = currentScreen === tab.key;
        const isSearch = tab.key === 'search';
        const tabStyle = isSearch
          ? [styles.centerTab, isActive && styles.tabActive]
          : [styles.tab, isActive && styles.tabActive];
        const textStyle = isSearch
          ? [styles.centerTabText, isActive && styles.tabTextActive]
          : [styles.tabText, isActive && styles.tabTextActive];
        return (
          <TouchableOpacity
            key={tab.key}
            style={tabStyle}
            onPress={() => onTabPress(tab.key)}
          >
            <Text style={textStyle}>
              {tab.label || (t ? t(tab.labelKey) : tab.key)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#222',
    backgroundColor: '#000',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 8,
    paddingBottom: 20,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6 },
  centerTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: '#111',
  },
  tabActive: { borderTopWidth: 3, borderTopColor: '#22c55e' },
  tabText: { color: '#888', fontSize: 14, fontFamily: 'Iceland_400Regular' },
  centerTabText: { color: '#888', fontSize: 14, fontFamily: 'Iceland_400Regular', fontWeight: '600' },
  tabTextActive: { color: '#22c55e', fontWeight: '600', fontFamily: 'Iceland_400Regular' },
});
