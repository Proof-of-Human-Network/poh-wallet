import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

export default function SegmentedControl({ options, value, onChange, t }) {
  return (
    <View style={styles.container}>
      {options.map((opt) => {
        const isActive = opt.key === value;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[
              styles.segment,
              isActive && styles.segmentActive,
            ]}
            onPress={() => onChange(opt.key)}
          >
            <Text style={[
              styles.label,
              isActive && styles.labelActive,
            ]}>
              {t ? t(opt.labelKey) : opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 4,
    marginBottom: 12,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: '#22c55e',
  },
  label: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  labelActive: {
    color: '#000',
  },
});
