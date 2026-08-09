import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, radius } from '../theme';

/**
 * "You moved up or down" since last time — the same small pill the
 * Progress tab uses for a weight delta, reused on a Studio session row so a
 * change reads identically everywhere in the app.
 */
export function DeltaChip({ value, unit, style }: { value: number; unit: string; style?: object }) {
  const theme = useTheme();
  const up = value > 0;
  const flat = value === 0;
  const color = up ? theme.accent : theme.inkSoft;
  return (
    <View
      style={[
        {
          flexDirection: 'row', alignItems: 'center', gap: 3,
          backgroundColor: up ? `${theme.accent}1F` : 'transparent',
          borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: 8,
        },
        style,
      ]}
    >
      {!flat && <Ionicons name={up ? 'arrow-up' : 'arrow-down'} size={11} color={color} />}
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>
        {flat ? '—' : `${up ? '+' : ''}${value} ${unit}`}
      </Text>
    </View>
  );
}
