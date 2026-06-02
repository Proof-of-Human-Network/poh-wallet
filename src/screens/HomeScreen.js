import React from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet } from 'react-native';

/**
 * Home screen - balance + recent activity
 * Props will be passed from App.js during the refactor.
 */
export default function HomeScreen(props) {
  const { t, selectedAddress, currentBalance, balances, txs, loading, lastSync, wallets, onRefresh, onNavigate } = props;

  return (
    <View style={{ flex: 1 }}>
      {/* Content will be moved from the old giant App.js if (currentScreen === 'home') block */}
      <Text style={{ color: '#fff', padding: 20 }}>HomeScreen (refactored)</Text>
    </View>
  );
}
