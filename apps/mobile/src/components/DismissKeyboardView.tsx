import { ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleProp, TouchableWithoutFeedback, View, ViewStyle } from 'react-native';

export function DismissKeyboardView({
  children, style, active = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * A long scrollable child (e.g. StartingWeightsStep, rendered mid-tree
   * inside an already-mounted PlanPreview) doesn't reliably scroll when
   * nested under this component's TouchableWithoutFeedback/
   * KeyboardAvoidingView — real bug report: scroll only starts working
   * after the keyboard has opened once. Callers that know they're about
   * to show a long scrollable step can flip this to false to render a
   * plain View instead, keeping the same padding/layout without the
   * touch-interception and keyboard-relayout machinery a static form
   * needs but a long list doesn't.
   */
  active?: boolean;
}) {
  if (!active) {
    return <View style={[{ flex: 1 }, style]}>{children}</View>;
  }
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={[{ flex: 1 }, style]}>{children}</View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}
