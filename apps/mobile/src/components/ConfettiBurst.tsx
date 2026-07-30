import { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';

const COLORS = ['#FF5A5F', '#FFB400', '#2ECC71', '#3498DB', '#9B59B6', '#FF7EB6', '#1ABC9C', '#F1C40F'];
const PIECE_COUNT = 70;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface Piece {
  x: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
  spin: number;
  sway: number;
  round: boolean;
}

function makePieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }, () => ({
    x: Math.random() * SCREEN_W,
    size: 6 + Math.random() * 7,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    delay: Math.random() * 350,
    duration: 1800 + Math.random() * 1400,
    spin: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540),
    sway: (Math.random() - 0.5) * 90,
    round: Math.random() > 0.5,
  }));
}

/** One falling, spinning, swaying piece — driven by a single native-thread Animated.Value. */
function ConfettiPiece({ piece }: { piece: Piece }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: piece.duration,
      delay: piece.delay,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [piece, progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-24, SCREEN_H + 24] });
  const translateX = progress.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, piece.sway, 0, -piece.sway, 0],
  });
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${piece.spin}deg`] });
  const opacity = progress.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: piece.x,
        width: piece.size,
        height: piece.size * (piece.round ? 1 : 1.6),
        backgroundColor: piece.color,
        borderRadius: piece.round ? piece.size / 2 : 2,
        opacity,
        transform: [{ translateY }, { translateX }, { rotate }],
      }}
    />
  );
}

/**
 * A one-shot confetti rain for finishing a workout (System Design §18):
 * pure Animated API, no native module, so it's free in Expo Go and any
 * EAS build alike. `active` toggling true regenerates a fresh burst;
 * the caller is responsible for flipping it back off after ~2.5s.
 */
export function ConfettiBurst({ active }: { active: boolean }) {
  const pieces = useMemo(() => (active ? makePieces() : []), [active]);
  if (!active) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 999 }]}>
      {pieces.map((p, i) => (
        <ConfettiPiece key={i} piece={p} />
      ))}
    </View>
  );
}
