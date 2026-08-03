import { Tabs } from 'expo-router';
import { Text, useColorScheme, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, TAB_BAR_HEIGHT, TAB_BAR_BOTTOM_MARGIN } from '../../src/theme';

function TabIcon({
  name, label, focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  focused: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{
      alignItems: 'center', justifyContent: 'center', gap: 2,
      paddingHorizontal: spacing.md, paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: focused ? theme.surface : 'transparent',
    }}>
      <Ionicons name={name} size={20} color={focused ? theme.accent : theme.inkSoft} />
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
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} label={t('chatTitle')} focused={focused} />
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
        name="plans"
        options={{
          title: t('trainingPlans'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'barbell' : 'barbell-outline'} label={t('trainingPlans')} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('settingsTitle'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'settings' : 'settings-outline'} label={t('settingsTitle')} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
