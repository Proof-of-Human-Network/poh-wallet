import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function Header({ title, onSettingsPress, t }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title || (t ? t('app.title') : 'POH Wallet')}</Text>
      <TouchableOpacity onPress={onSettingsPress}>
        <Text style={styles.settingsLink}>
          {t ? t('nav.settings') : 'Settings'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 26,
    color: '#22c55e',
    fontWeight: '700',
    fontFamily: 'Iceland_400Regular',
  },
  settingsLink: {
    color: '#22c55e',
    fontWeight: '600',
  },
});
