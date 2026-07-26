import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * GYM-31 (passive relay): register the device's Expo push token so the
 * backend can deliver coach replies when the app is backgrounded.
 * Best-effort — a denied permission never blocks the app.
 */
export async function registerPush(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulators have no push
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )).data;
    await supabase.from('push_tokens').upsert({
      user_id: userId,
      token,
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Push is a nice-to-have; never crash registration.
  }
}
