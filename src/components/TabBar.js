import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

const TABS = [
  { key: 'home',    icon: '●', iconOff: '○', labelKey: 'tab.home' },
  { key: 'history', icon: '⇄', iconOff: '⇄', labelKey: 'tab.history' },
  { key: 'p2p',     icon: '⇋', iconOff: '⇋', label: 'P2P' },
  { key: 'chat',    icon: '✦', iconOff: '✦', label: 'Ask AI' },
  { key: 'search',  icon: '⊙', iconOff: '⊙', label: 'Scan' },
];

export default function TabBar({ currentScreen, onTabPress, t }) {
  return (
    <View style={styles.tabBar}>
      {TABS.map(tab => {
        const isActive = currentScreen === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onTabPress(tab.key)}
          >
            <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>
              {isActive ? tab.icon : tab.iconOff}
            </Text>
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
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
    paddingTop: 4,
    paddingBottom: 16,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4 },
  tabActive: { borderTopWidth: 3, borderTopColor: '#22c55e' },
  tabIcon: { color: '#888', fontSize: 16, fontFamily: 'Iceland_400Regular' },
  tabIconActive: { color: '#22c55e' },
  tabText: { color: '#888', fontSize: 11, fontFamily: 'Iceland_400Regular', marginTop: 2 },
  tabTextActive: { color: '#22c55e', fontWeight: '600', fontFamily: 'Iceland_400Regular' },
});
