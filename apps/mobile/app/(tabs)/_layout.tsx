import { Tabs, usePathname } from 'expo-router';
import { Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useUnread } from '../../src/lib/unread';
import { useUpdateNudge } from '../../src/lib/appUpdate';
import { useFlag } from '../../src/lib/flags';
import { RestTimer } from '../../src/components/RestTimer';
import { useTheme, spacing, TAB_BAR_HEIGHT, TAB_BAR_BOTTOM_MARGIN } from '../../src/theme';

function TabIcon({
  name, label, focused, badge,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  focused: boolean;
  /** A reply that arrived while this tab wasn't the one showing — see unread.tsx. */
  badge?: number;
}) {
  const theme = useTheme();
  return (
    <View style={{
      alignItems: 'center', justifyContent: 'center', gap: 2,
      paddingHorizontal: spacing.md, paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: focused ? theme.surface : 'transparent',
    }}>
      <View>
        <Ionicons name={name} size={20} color={focused ? theme.accent : theme.inkSoft} />
        {!!badge && (
          <View style={{
            position: 'absolute', top: -4, right: -8, minWidth: 15, height: 15, borderRadius: 8,
            backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
          }}>
            <Text style={{ color: theme.onAccent, fontSize: 9.5, fontWeight: '800' }}>{`+${Math.min(badge, 9)}`}</Text>
          </View>
        )}
      </View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        style={{ fontSize: 10, fontWeight: '700', color: focused ? theme.accent : theme.inkSoft, maxWidth: 76 }}
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { count: unread } = useUnread();
  const pathname = usePathname();
  // The coach assistant tab (NH-70) exists only for accounts with the flag —
  // real users keep today's three tabs. href: null hides it without
  // unmounting the route, so a flag turned off mid-use just shows its notice.
  const assistantChat = useFlag('assistant_chat');
  // Soft, dismissible "update available" nudge (once per version). The hard
  // update gate lives in the entry router (app/index.tsx); this is the
  // non-blocking counterpart for optional updates.
  useUpdateNudge();
  // The chat screen ("/train") shows its own docked RestTimer above the
  // composer — this pill is the same object at a third, quieter density
  // for every other tab (guidelines/rest-timer.html), so it only renders
  // away from chat. RestTimer itself already renders nothing while idle.
  const showRestPill = pathname !== '/train';

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        // The library's default icon slot is a fixed, icon-only 31x28 box
        // (@react-navigation/bottom-tabs' TabBarIcon wrapperUikit) — too
        // small for TabIcon's icon+label column, which was getting
        // squashed down to nothing inside it. This is the supported
        // override for a custom combined icon+label.
        tabBarIconStyle: { width: 84, height: TAB_BAR_HEIGHT - 12 },
        tabBarStyle: {
          position: 'absolute',
          left: 20,
          right: 20,
          bottom: TAB_BAR_BOTTOM_MARGIN,
          height: TAB_BAR_HEIGHT,
          borderRadius: TAB_BAR_HEIGHT / 2,
          borderTopWidth: 0,
          backgroundColor: 'transparent',
          elevation: 8,
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          // The bar already floats clear of the home indicator (bottom
          // margin above), so it needs none of the default safe-area
          // bottom padding a docked-to-the-edge bar would — without this,
          // that inherited padding squeezes the icon+label content out of
          // the fixed height above.
          paddingBottom: 0,
          paddingTop: 0,
        },
        tabBarBackground: () => (
          <BlurView
            intensity={60}
            tint="dark"
            style={{ flex: 1, borderRadius: TAB_BAR_HEIGHT / 2, overflow: 'hidden', backgroundColor: `${theme.bg}B3` }}
          />
        ),
      }}
    >
      {/* "index" is now the Plans screen (app/(tabs)/index.tsx) — Plans is
          the app's default/cold-start tab, which in Expo Router means
          whichever file is literally named index.tsx, not a navigator-level
          setting. Chat lives at "train" instead. Tab bar visual order
          (Train, the flag-gated Assistant, Progress, Plans) is independent of this and just follows
          the order these are declared below. */}
      <Tabs.Screen
        name="train"
        options={{
          title: t('trainTab'),
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name={focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
              label={t('trainTab')}
              focused={focused}
              badge={unread}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          href: assistantChat ? undefined : null,
          title: t('assistantTab'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'sparkles' : 'sparkles-outline'} label={t('assistantTab')} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: t('progressTitle'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'stats-chart' : 'stats-chart-outline'} label={t('progressTitle')} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: t('plansTab'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'barbell' : 'barbell-outline'} label={t('plansTab')} focused={focused} />
          ),
        }}
      />
    </Tabs>
    {showRestPill && <RestTimer variant="pill" />}
    </View>
  );
}
