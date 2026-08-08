import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useRestTimer } from '../lib/restTimer';
import { formatCountdown, isFinalStretch, ringProgress } from '../lib/restTimerLogic';
import { useLanguage } from '../lib/language';
import { useTheme, radius, spacing, TAB_BAR_BOTTOM_MARGIN, TAB_BAR_CLEARANCE, TAB_BAR_HEIGHT } from '../theme';

// Mirrors the Notch Design System's components/feedback/RestTimer.jsx as
// closely as React Native allows — same states, same layout per state, same
// default copy. Token names in comments are the design's CSS custom
// properties; this app's simpler theme doesn't have 1:1 equivalents for all
// of them (no --ground-300/"raised" surface, no IBM Plex Mono), so those are
// approximated rather than introducing new design tokens for one component.
const HIT_TARGET = 44;
const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
/** Approximates --action-secondary-bg (ground-300, "raised") — a step lighter than the surface it sits on, which this app's theme has no token for. */
const SECONDARY_BG = 'rgba(255,255,255,0.06)';

function Ring({
  size, strokeWidth, progress, color, trackColor,
}: {
  size: number; strokeWidth: number; progress: number; color: string; trackColor: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
      <Circle
        cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={strokeWidth} fill="none"
        strokeLinecap="round"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={circumference * (1 - progress)}
      />
    </Svg>
  );
}

/** Pulses in the final 3 seconds (design's notch-breathe) — rest ending is not a warning, so this pulses rather than turning amber/red. */
function usePulse(active: boolean) {
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.55, duration: 450, useNativeDriver: true }),
        Animated.timing(value, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, value]);
  return value;
}

/** components/core/Button.jsx's secondary/quiet variants, the two this component uses. */
function TimerButton({
  label, icon, onPress, variant, compact, block,
}: {
  label: string; icon?: React.ReactNode; onPress: () => void;
  variant: 'secondary' | 'quiet'; compact?: boolean; block?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
        minHeight: HIT_TARGET, borderRadius: radius.pill, width: block ? '100%' : undefined,
        paddingHorizontal: block ? spacing.lg : compact ? spacing.md - 2 : spacing.md,
        backgroundColor: variant === 'secondary' ? SECONDARY_BG : 'transparent',
        borderWidth: variant === 'secondary' ? 1.5 : 0,
        borderColor: theme.rule,
      }}
    >
      {icon}
      <Text style={{
        color: variant === 'secondary' ? theme.ink : theme.inkSoft,
        fontWeight: '700', fontSize: block ? 15 : compact ? 12 : 13,
      }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Rest timer — components/feedback/RestTimer.jsx. A single object at three
 * densities: docked (collapsed/expanded, chat screen) and a pill everywhere
 * else. `done` is its own compact bar regardless of expanded/collapsed —
 * reaching zero always collapses back down. Reads straight from
 * RestTimerProvider so every call site stays a one-liner; renders nothing
 * while idle.
 */
export function RestTimer({ variant = 'docked' }: { variant?: 'docked' | 'pill' }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { dir } = useLanguage();
  const {
    phase, remaining, total, expanded, setExpanded, add, subtract, pause, resume, skip, dismiss,
  } = useRestTimer();

  const pulseActive = phase === 'running' && isFinalStretch(remaining);
  const pulse = usePulse(pulseActive);

  if (phase === 'idle') return null;

  const progress = ringProgress(remaining, total);
  const done = phase === 'done';
  const paused = phase === 'paused';
  const countdown = formatCountdown(remaining);
  // running -> accent; paused -> muted (design: var(--ink-300), not the accent — a paused ring shouldn't read as "still going").
  const color = paused ? theme.inkSoft : theme.accent;
  const row = { flexDirection: dir === 'rtl' ? ('row-reverse' as const) : ('row' as const) };

  if (variant === 'pill') {
    return (
      <Pressable
        onPress={() => router.push('/(tabs)')}
        accessibilityRole="button"
        accessibilityLabel={`${done ? t('restDone') : `${t('restLabel')} ${countdown}`} — ${t('chatTitle')}`}
        style={{
          position: 'absolute', left: 20, right: 20,
          bottom: TAB_BAR_BOTTOM_MARGIN + TAB_BAR_HEIGHT + spacing.sm,
          minHeight: 48, borderRadius: 999, overflow: 'hidden',
          backgroundColor: done ? theme.accent : undefined,
          shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
        }}
      >
        {!done && (
          <BlurView intensity={60} tint="dark" style={[StyleSheet.absoluteFill, { backgroundColor: `${theme.bg}B3` }]} />
        )}
        <View style={{ ...row, alignItems: 'center', gap: spacing.sm, paddingHorizontal: 14, minHeight: 48 }}>
          <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
            {done ? (
              <Ionicons name="checkmark-circle" size={20} color={theme.onAccent} />
            ) : (
              <>
                <Ring size={28} strokeWidth={3} progress={progress} color={color} trackColor={theme.rule} />
                <Ionicons
                  name={paused ? 'pause' : 'timer-outline'} size={11} color={color}
                  style={{ position: 'absolute' }}
                />
              </>
            )}
          </View>
          <Text style={{
            color: done ? theme.onAccent : theme.ink, fontWeight: '800', fontSize: 16,
            fontFamily: MONO_FONT, fontVariant: ['tabular-nums'],
          }}>
            {done ? t('restDone') : countdown}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              flex: 1, color: done ? theme.onAccent : theme.inkSoft, opacity: done ? 0.72 : 1, fontSize: 12,
              textAlign: dir === 'rtl' ? 'right' : 'left',
            }}
          >
            {t('restLabel')}
          </Text>
          <Ionicons
            name="chevron-forward" size={16} color={done ? theme.onAccent : theme.inkSoft}
            style={dir === 'rtl' ? { transform: [{ scaleX: -1 }] } : undefined}
          />
        </View>
      </Pressable>
    );
  }

  // Done is its own compact bar — always this, regardless of expanded —
  // the coach owns the finish; this just hands off, it doesn't decide.
  if (done) {
    return (
      <View style={{
        backgroundColor: theme.accent, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4,
        ...row, alignItems: 'center', gap: spacing.sm + 2,
      }}>
        <Ionicons name="checkmark-circle" size={22} color={theme.onAccent} />
        <Text style={{
          flex: 1, color: theme.onAccent, fontWeight: '800', fontSize: 14,
          textAlign: dir === 'rtl' ? 'right' : 'left',
        }}>
          {t('restDone')}
        </Text>
        <Pressable
          onPress={dismiss}
          style={{
            backgroundColor: theme.onAccent, borderRadius: radius.pill, paddingHorizontal: spacing.md,
            minHeight: HIT_TARGET, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 13 }}>{t('restDismiss')}</Text>
        </Pressable>
      </View>
    );
  }

  if (expanded) {
    return (
      <View
        style={{
          backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.rule,
          paddingHorizontal: spacing.md, paddingTop: spacing.sm + 4, paddingBottom: TAB_BAR_CLEARANCE,
        }}
      >
        <View style={{ ...row, justifyContent: 'flex-end' }}>
          <Pressable
            onPress={() => setExpanded(false)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            style={{ width: HIT_TARGET, height: HIT_TARGET, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="chevron-down" size={20} color={theme.inkSoft} />
          </Pressable>
        </View>
        <View style={{ alignItems: 'center', paddingVertical: spacing.xs + 2, paddingBottom: spacing.md - 2 }}>
          <View style={{ width: 132, height: 132, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={{ position: 'absolute', opacity: pulse }}>
              <Ring size={132} strokeWidth={6} progress={progress} color={color} trackColor={theme.rule} />
            </Animated.View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{
                color: paused ? theme.inkSoft : theme.ink, fontSize: 38, fontWeight: '800',
                fontFamily: MONO_FONT, fontVariant: ['tabular-nums'],
              }}>
                {countdown}
              </Text>
              <Text style={{
                color: theme.inkSoft, fontSize: 11, fontWeight: '700', letterSpacing: 0.6,
                textTransform: 'uppercase', marginTop: 4,
              }}>
                {paused ? t('restPaused') : t('restLabel')}
              </Text>
            </View>
          </View>
        </View>
        <View style={{ ...row, gap: spacing.sm, marginBottom: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <TimerButton label={t('restSubtract')} variant="secondary" onPress={subtract} />
          </View>
          <View style={{ flex: 1 }}>
            <TimerButton
              label={paused ? t('restResume') : t('restPause')}
              icon={<Ionicons name={paused ? 'play' : 'pause'} size={15} color={theme.ink} />}
              variant="secondary"
              onPress={paused ? resume : pause}
            />
          </View>
          <View style={{ flex: 1 }}>
            <TimerButton label={t('restAdd')} variant="secondary" onPress={add} />
          </View>
        </View>
        <TimerButton label={t('restSkip')} variant="quiet" block onPress={skip} />
      </View>
    );
  }

  // Collapsed — the resting default. Only +30s and Skip live here;
  // adjusting down or pausing is expanded-only (tap the readout).
  return (
    <View
      style={{
        backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.rule, overflow: 'hidden',
      }}
    >
      <View
        style={{
          position: 'absolute', top: 0, height: 2, backgroundColor: color, width: `${progress * 100}%`,
          ...(dir === 'rtl' ? { right: 0 } : { left: 0 }),
        }}
      />
      <View style={{
        ...row, alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm + 2, minHeight: 56,
        // The trailing edge is tighter than the leading one on purpose —
        // Skip's own quiet-variant padding already adds visual buffer, so
        // matching the full spacing.md inset here would read as floating
        // away from the row's true end.
        ...(dir === 'rtl' ? { paddingLeft: spacing.sm, paddingRight: spacing.md } : { paddingLeft: spacing.md, paddingRight: spacing.sm }),
      }}>
        <Pressable
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel={`${t('restLabel')} ${countdown}`}
          style={{ ...row, alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 }}
        >
          <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={{ position: 'absolute', opacity: pulse }}>
              <Ring size={34} strokeWidth={3} progress={progress} color={color} trackColor={theme.rule} />
            </Animated.View>
            <Ionicons name={paused ? 'pause' : 'timer-outline'} size={13} color={color} />
          </View>
          <View style={{ minWidth: 0 }}>
            <Text style={{
              color: paused ? theme.inkSoft : theme.ink, fontSize: 20, fontWeight: '800',
              fontFamily: MONO_FONT, fontVariant: ['tabular-nums'],
            }}>
              {countdown}
            </Text>
            <Text numberOfLines={1} style={{ color: theme.inkSoft, fontSize: 12, marginTop: 1 }}>
              {paused ? t('restPaused') : t('restLabel')}
            </Text>
          </View>
        </Pressable>
        <View style={{ flexShrink: 0 }}>
          <TimerButton label={t('restAdd')} variant="secondary" compact onPress={add} />
        </View>
        <View style={{ flexShrink: 0 }}>
          <TimerButton label={t('restSkip')} variant="quiet" compact onPress={skip} />
        </View>
      </View>
    </View>
  );
}
