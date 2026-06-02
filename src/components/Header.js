import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';

export default function Header({ title, onSettingsPress, t }) {
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Image 
          source={require('../../assets/logo.png')} 
          style={styles.logo} 
          resizeMode="contain"
        />
        <Text style={styles.title}>{title || (t ? t('app.title') : 'POH Wallet')}</Text>
      </View>
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    width: 28,
    height: 28,
    marginRight: 8,
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
