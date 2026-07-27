import Svg, { Circle, Polyline } from 'react-native-svg';
import { useTheme } from '../theme';

/** Small, axis-free sparkline — deliberately minimal (GYM-62). */
export function LineChart({
  values, width = 120, height = 40,
}: { values: number[]; width?: number; height?: number }) {
  const theme = useTheme();
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const pad = 4;
  const plotHeight = height - pad * 2;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;

  const y = (v: number) => pad + (range === 0 ? plotHeight / 2 : plotHeight - ((v - min) / range) * plotHeight);
  const points = values.map((v, i) => ({ x: values.length > 1 ? i * stepX : width / 2, y: y(v) }));
  const last = points[points.length - 1];

  return (
    <Svg width={width} height={height}>
      {points.length > 1 && (
        <Polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={theme.accent}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <Circle cx={last.x} cy={last.y} r={3} fill={theme.accent} />
    </Svg>
  );
}
