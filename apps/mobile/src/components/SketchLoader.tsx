import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';
import { useTheme, spacing } from '../theme';
import { SKETCHES, SKETCH_ORDER, type SketchKey } from './sketchLoaderPaths';
import { estimatePathLength } from './svgPathLength';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// The 6 sketches' paths are fixed data — their lengths never change, so
// compute each one once and reuse it for every mount/cycle instead of
// re-sampling the bezier curves on every render.
const pathLengthCache = new Map<string, number>();
function lengthOf(d: string): number {
  let len = pathLengthCache.get(d);
  if (len == null) {
    len = estimatePathLength(d);
    pathLengthCache.set(d, len);
  }
  return len;
}

// Mirrors the Notch Design System's --ease-in-out / --ease-out tokens
// (tokens/motion.css) exactly, so the draw/hold/erase and label-rise
// curves match the design spec bezier-for-bezier.
const EASE_IN_OUT = Easing.bezier(0.4, 0, 0.2, 1);
const EASE_OUT = Easing.bezier(0.2, 0.8, 0.2, 1);

// --volt-400 — the orbit arc's own deeper accent shade. Not in the app's
// simplified theme tokens (theme.accent only covers --volt-200), and not
// worth adding a whole new theme field for a single decorative stroke.
const ORBIT_COLOR = '#2AB463';

// notch-boil (tokens/base.css): a sub-pixel jitter on discrete steps, not
// a smooth tween — that's what sells "hand-drawn ink" instead of "plotted
// line". Four held states, ~85ms apart (340ms / 4), looping.
const BOIL_STEPS: Array<{ x: number; y: number; r: number }> = [
  { x: 0, y: 0, r: 0 },
  { x: 0.5, y: -0.4, r: 0.4 },
  { x: -0.3, y: 0.45, r: -0.35 },
  { x: 0.35, y: 0.3, r: 0.25 },
];
const BOIL_STEP_MS = 85;

function useBoil() {
  const step = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % BOIL_STEPS.length;
      const s = BOIL_STEPS[i];
      step.setValue({ x: s.x, y: s.y });
      rotate.setValue(s.r);
    }, BOIL_STEP_MS);
    return () => clearInterval(id);
  }, [step, rotate]);
  return { step, rotate };
}

/**
 * One sketch object's stroke-draw loop: draw in (0 -> 38% of cycle),
 * hold fully drawn (38% -> 70%), erase away (70% -> 100%), repeat forever
 * — matches notch-stroke's keyframe percentages exactly, just in each
 * path's own real length units instead of a normalized 0-1 (see
 * svgPathLength.ts). Ending at -length instead of resetting to +length is
 * deliberate, not a missing step: with strokeDasharray = length the dash
 * pattern repeats every 2*length units, so -length and +length render as
 * the exact same fully-hidden state — CSS's implicit iteration reset is
 * visually identical to just continuing the tween, and skipping the reset
 * avoids a discontinuity in the loop.
 */
function SketchPaths({
  paths, color, stroke, cycleMs,
}: {
  paths: string[];
  color: string;
  stroke: number;
  cycleMs: number;
}) {
  const lengths = useMemo(() => paths.map(lengthOf), [paths]);
  const values = useRef(lengths.map((len) => new Animated.Value(len))).current;

  useEffect(() => {
    const anims = values.map((val, n) => Animated.loop(
      Animated.sequence([
        Animated.timing(val, {
          toValue: 0, duration: cycleMs * 0.38, easing: EASE_IN_OUT, useNativeDriver: false,
        }),
        Animated.delay(cycleMs * 0.32),
        Animated.timing(val, {
          toValue: -lengths[n], duration: cycleMs * 0.30, easing: EASE_IN_OUT, useNativeDriver: false,
        }),
      ]),
    ));
    // Per-path stagger (n*70ms), same as the source's animation-delay —
    // applied once before each loop starts, not repeated every cycle (a
    // CSS animation-delay only holds up the first iteration, not every one).
    const timers = anims.map((anim, n) => setTimeout(() => anim.start(), n * 70));
    return () => {
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.stop());
    };
  }, [values, lengths, cycleMs]);

  return (
    <G fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d, n) => (
        <AnimatedPath
          key={n} d={d} strokeDasharray={`${lengths[n]}`} strokeDashoffset={values[n]}
        />
      ))}
    </G>
  );
}

/**
 * Hand-drawn gym sketches that draw themselves — for waits long enough
 * that a bare ring would feel like nothing is happening (plan generation,
 * file parsing, history import). For sub-second waits, use ActivityIndicator
 * instead; this needs time to read as drawing.
 *
 * Ported from the Notch Design System's SketchLoader (components/loading/
 * SketchLoader.jsx) — the design spec explicitly flags that CSS stroke-dash
 * animation "doesn't survive react-native-svg" and suggests Lottie/a frame
 * sequence instead, but react-native-svg does support animating
 * strokeDashoffset directly via Animated (the same technique used for
 * animated progress rings), so this reproduces the real draw/hold/erase
 * loop rather than a pre-baked asset — no export pipeline, and the exact
 * path geometry in sketchLoaderPaths.ts stays the single source of truth.
 */
export function SketchLoader({
  size = 132,
  objects = SKETCH_ORDER,
  label,
  orbit = true,
  cycleMs = 1800,
  speed = 1,
  stroke = 2.6,
  color,
  dir = 'ltr',
  style,
}: {
  /** Px. 132 is the tuned default; below ~72 the sketch detail closes up. */
  size?: number;
  /** Which sketches to cycle, in order. Defaults to all six. Pass one key for a static single-object loader. */
  objects?: SketchKey[];
  /** Status line beneath. Changing it re-triggers the rise animation. */
  label?: string;
  /** The sketchy arc that circles the object. Off for a calmer loader. */
  orbit?: boolean;
  /** Ms for one full draw -> hold -> erase loop, and the interval at which the next object takes over. */
  cycleMs?: number;
  /** Global multiplier — 1.4 is noticeably urgent, 0.7 relaxed. */
  speed?: number;
  /** Stroke width in viewBox units. Raise for small sizes. */
  stroke?: number;
  /** Stroke colour. Defaults to the accent; pass theme.ink/inkSoft for quiet contexts. */
  color?: string;
  /** RTL mirrors the sketch so it faces the reading direction. */
  dir?: 'ltr' | 'rtl';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const strokeColor = color ?? theme.accent;
  const keys = useMemo(() => objects.filter((k) => SKETCHES[k]), [objects]);
  const cycle = Math.round(cycleMs / speed);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (keys.length < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % keys.length), cycle);
    return () => clearInterval(id);
  }, [keys.length, cycle]);

  const activeKey = keys[i] ?? keys[0];
  const active = SKETCHES[activeKey];

  const orbitSpin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!orbit) return undefined;
    const loop = Animated.loop(
      Animated.timing(orbitSpin, {
        toValue: 1, duration: Math.round(2600 / speed), easing: Easing.linear, useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [orbit, orbitSpin, speed]);
  const orbitRotate = orbitSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const { step, rotate: boilRotate } = useBoil();
  const boilDeg = boilRotate.interpolate({ inputRange: [-1, 1], outputRange: ['-1deg', '1deg'] });

  const labelRise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!label) return;
    labelRise.setValue(0);
    Animated.timing(labelRise, { toValue: 1, duration: 320, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [label, labelRise]);

  return (
    <View style={[{ alignItems: 'center', gap: spacing.md }, style]}>
      <View style={{ width: size, height: size }}>
        {orbit && (
          <Animated.View style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            transform: [{ rotate: orbitRotate }],
          }}
          >
            <Svg viewBox="0 0 100 100" width={size} height={size}>
              <Path
                d="M50,6 C74,6.5 94,26 94,50" fill="none" stroke={ORBIT_COLOR}
                strokeWidth={2.2} strokeLinecap="round" opacity={0.75}
              />
            </Svg>
          </Animated.View>
        )}
        <Animated.View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          transform: [
            { translateX: step.x }, { translateY: step.y }, { rotate: boilDeg },
            { scaleX: dir === 'rtl' ? -1 : 1 },
          ],
        }}
        >
          <Svg viewBox="0 0 100 100" width={size} height={size} key={activeKey}>
            <SketchPaths paths={active.paths} color={strokeColor} stroke={stroke} cycleMs={cycle} />
          </Svg>
        </Animated.View>
      </View>
      {label && (
        <Animated.Text
          key={label}
          style={{
            color: theme.inkSoft, fontSize: 14.5, fontWeight: '600', textAlign: 'center',
            opacity: labelRise,
            transform: [{ translateY: labelRise.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
          }}
        >
          {label}
        </Animated.Text>
      )}
    </View>
  );
}
