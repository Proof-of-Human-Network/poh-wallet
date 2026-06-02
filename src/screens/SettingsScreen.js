import React from 'react';
import { View, Text } from 'react-native';

/**
 * Settings screen now contains segmented tabs for "Nodes" and "Language".
 */
export default function SettingsScreen(props) {
  const { settingsTab, setSettingsTab, t, nodes, ...rest } = props;

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: '#fff', padding: 20 }}>SettingsScreen (Nodes + Language tabs)</Text>
      {/* The segmented control + conditional Nodes/Language content will live here after full extraction */}
    </View>
  );
}
