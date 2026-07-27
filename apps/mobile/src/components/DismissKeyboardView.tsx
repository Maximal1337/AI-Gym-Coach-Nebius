import { ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleProp, TouchableWithoutFeedback, View, ViewStyle } from 'react-native';

export function DismissKeyboardView({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={[{ flex: 1 }, style]}>{children}</View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}
