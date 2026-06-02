import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

const TABS = [
  { key: 'home', labelKey: 'tab.home' },
  { key: 'send', labelKey: 'tab.send' },
  { key: 'receive', labelKey: 'tab.receive' },
  { key: 'history', labelKey: 'tab.history' },
  { key: 'wallets', labelKey: 'tab.wallets' },
];

export default function TabBar({ currentScreen, onTabPress, t }) {
  return (
    <View style={styles.tabBar}>
      {TABS.map((tab) => {
        const isActive = currentScreen === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onTabPress(tab.key)}
          >
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
              {t ? t(tab.labelKey) : tab.key}
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
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabActive: { borderTopWidth: 3, borderTopColor: '#22c55e' },
  tabText: { color: '#888', fontSize: 12, fontFamily: 'Iceland_400Regular' },
  tabTextActive: { color: '#22c55e', fontWeight: '600', fontFamily: 'Iceland_400Regular' },
});
