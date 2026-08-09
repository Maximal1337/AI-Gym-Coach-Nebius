import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, Text, View, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { useTheme, radius, spacing } from '../theme';

// Seeds the centering math with a plausible width up front (the screen's
// own width, minus roughly what a row's own padding/margins eat) instead of
// starting at 0 and waiting for the first onLayout. Starting at 0 meant the
// marker and the scroll strip rendered nothing at all for one frame, then
// popped in full-size once measured — visible as a jump every time a row
// expanded. onLayout still refines this to the exact number; this estimate
// just means there's nothing to visibly pop between.
const ESTIMATED_WIDTH = Dimensions.get('window').width - spacing.lg * 2 - spacing.md * 2;

export const UNIT_PRESETS: Record<string, { step: number; min: number; max: number }> = {
  reps: { step: 1, min: 0, max: 200 },
  cals: { step: 5, min: 0, max: 120 },
  m: { step: 50, min: 0, max: 2000 },
  // 2kg — round, matches real dumbbell racks (2/4/6/8/10...50) across the
  // whole practical range, rather than a flat 2.5 that's coarse at the
  // light end and non-round at the heavy end. One constant step by design
  // — not the light/medium/heavy tiering real equipment charts use, to
  // keep the scroller's value generation simple.
  kg: { step: 2, min: 0, max: 200 },
  // Commercial imperial dumbbell racks step in 5s (5/10/15.../100+); same
  // one-constant-step choice as kg.
  lbs: { step: 5, min: 0, max: 200 },
  lengths: { step: 1, min: 0, max: 20 },
  rounds: { step: 1, min: 1, max: 20 },
  min: { step: 1, min: 1, max: 60 },
  sec: { step: 5, min: 5, max: 180 },
  cm: { step: 5, min: 0, max: 120 },
};

const STOP_WIDTH = 76;

// rgba mixes for the tier/marker treatment — same local-token approach
// ChoiceCard uses for VOLT_WASH/VOLT_BORDER, since the app's Theme type
// doesn't carry a distinct volt-wash/volt-tint pair.
const VOLT_WASH = 'rgba(98, 252, 152, 0.12)';
const VOLT_BORDER = '#45DE7F';

/**
 * Ported from the Notch Design System's UnitScroller
 * (components/forms/UnitScroller.jsx, refined in
 * guidelines/studio-workout-entry.html). The core control for every number
 * in the Studio feature — dragged rather than aimed at, because this gets
 * used at a heart rate where tapping a precise numeric-keypad target is the
 * first interaction people abandon.
 *
 * Filled dot = a tier the coach offered on the board. Ring = where this
 * trainee was last time. Ring around a filled dot = they took that tier
 * last time. The strip shows numbers only — whatever opened it already
 * names the unit (see the overline label callers render above it).
 *
 * Deliberately LTR in its scroll physics regardless of `dir` — reversing a
 * ScrollView's own scroll axis for RTL without the app's (intentionally
 * unused) native I18nManager support is its own hazard, and a numeric
 * strip reading low-to-high left-to-right is a reasonable constant across
 * both reading directions, the same way a slider or a timeline usually is.
 */
export function UnitScroller({
  value, unit = 'reps', tiers = null, last = null, min, max, step, compact = false, onChange, style,
}: {
  value: number;
  unit: string;
  tiers?: number[] | null;
  last?: number | null;
  min?: number;
  max?: number;
  step?: number;
  compact?: boolean;
  onChange: (next: number) => void;
  style?: object;
}) {
  const theme = useTheme();
  const preset = UNIT_PRESETS[unit] ?? { step: 1, min: 0, max: 100 };
  const lo = min ?? preset.min;
  const hi = max ?? preset.max;
  const st = step ?? preset.step;

  const values = useMemo(() => {
    const out: number[] = [];
    for (let v = lo; v <= hi; v += st) out.push(Math.round(v * 100) / 100);
    for (const t of tiers ?? []) if (!out.includes(t)) out.push(t);
    if (last != null && !out.includes(last)) out.push(last);
    return out.sort((a, b) => a - b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lo, hi, st, (tiers ?? []).join(','), last]);

  const idx = Math.max(0, values.indexOf(value));
  const scrollRef = useRef<ScrollView>(null);
  const [containerWidth, setContainerWidth] = useState(ESTIMATED_WIDTH);
  const settling = useRef(false);

  useEffect(() => {
    if (settling.current) return;
    // Non-animated — this positions the strip on first paint (and whenever
    // the estimate above gets refined by onLayout, or the value changes
    // from outside), not a visible scroll motion.
    scrollRef.current?.scrollTo({ x: idx * STOP_WIDTH, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, containerWidth, values.length]);

  function onLayout(e: LayoutChangeEvent) {
    setContainerWidth(e.nativeEvent.layout.width);
  }

  function resolveScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    settling.current = false;
    const i = Math.max(0, Math.min(values.length - 1, Math.round(e.nativeEvent.contentOffset.x / STOP_WIDTH)));
    if (values[i] !== value) onChange(values[i]);
  }

  const h = compact ? 52 : 64;
  const sidePad = Math.max(0, (containerWidth - STOP_WIDTH) / 2);

  return (
    <View style={[{ position: 'relative', height: h }, style]} onLayout={onLayout}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', top: 0, bottom: 0, left: '50%', width: STOP_WIDTH, marginLeft: -STOP_WIDTH / 2,
          borderRadius: radius.field, backgroundColor: VOLT_WASH, borderWidth: 1.5, borderColor: VOLT_BORDER,
        }}
      />
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={STOP_WIDTH}
        decelerationRate="fast"
        onScrollBeginDrag={() => { settling.current = true; }}
        onMomentumScrollEnd={resolveScrollEnd}
        onScrollEndDrag={(e) => {
          // A slow drag with no residual momentum never fires
          // onMomentumScrollEnd — this catches that case too.
          if (e.nativeEvent.velocity && Math.abs(e.nativeEvent.velocity.x) < 0.05) resolveScrollEnd(e);
        }}
        contentContainerStyle={{ paddingHorizontal: sidePad, alignItems: 'center' }}
        style={{ height: h }}
      >
        {values.map((v, i) => {
            const on = i === idx;
            const isTier = (tiers ?? []).includes(v);
            const wasLast = last != null && v === last;
            return (
              <Pressable
                key={v}
                onPress={() => onChange(v)}
                accessibilityRole="button"
                accessibilityLabel={`${v} ${unit}`}
                accessibilityState={{ selected: on }}
                style={{
                  width: STOP_WIDTH, height: h, alignItems: 'center', justifyContent: 'center', gap: 2,
                }}
              >
                <Text
                  style={{
                    fontSize: on ? (compact ? 22 : 26) : 17,
                    fontWeight: on ? '800' : '600',
                    color: on ? theme.ink : isTier ? theme.accent : theme.inkSoft,
                  }}
                >
                  {v}
                </Text>
                {(isTier || wasLast) && (
                  <View
                    style={{
                      width: wasLast ? 10 : 4, height: wasLast ? 10 : 4, borderRadius: 5,
                      alignItems: 'center', justifyContent: 'center',
                      borderWidth: wasLast ? 1.5 : 0, borderColor: theme.ink,
                    }}
                  >
                    {isTier && (
                      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: on ? theme.accent : `${theme.accent}99` }} />
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
      </ScrollView>
    </View>
  );
}
