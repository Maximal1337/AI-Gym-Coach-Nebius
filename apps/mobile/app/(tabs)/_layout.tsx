import { Tabs } from 'expo-router';
import { Text, useColorScheme, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, TAB_BAR_HEIGHT, TAB_BAR_BOTTOM_MARGIN } from '../../src/theme';

function TabIcon({ emoji, label, focused }: { emoji: string; label: string; focused: boolean }) {
  const theme = useTheme();
  return (
    <View style={{
      alignItems: 'center', justifyContent: 'center', gap: 2,
      paddingHorizontal: spacing.md, paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: focused ? theme.surface : 'transparent',
    }}>
      <Text style={{ fontSize: 18 }}>{emoji}</Text>
      <Text style={{ fontSize: 10, fontWeight: '700', color: focused ? theme.accent : theme.inkSoft }}>
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
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
            tint={scheme === 'dark' ? 'dark' : 'light'}
            style={{ flex: 1, borderRadius: TAB_BAR_HEIGHT / 2, overflow: 'hidden', backgroundColor: `${theme.bg}B3` }}
          />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('chatTitle'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="💬" label={t('chatTitle')} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: t('progressTitle'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="📈" label={t('progressTitle')} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('settingsTitle'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="⚙️" label={t('settingsTitle')} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
