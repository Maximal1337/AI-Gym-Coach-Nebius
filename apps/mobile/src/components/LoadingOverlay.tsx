import { StyleSheet, View } from 'react-native';
import { SketchLoader } from './SketchLoader';
import type { SketchKey } from './sketchLoaderPaths';
import { useLanguage } from '../lib/language';

/**
 * A transparent scrim + a single sketch, dropped over whatever screen is
 * mid-request — the "analyze"/"archive" style buttons that call an edge
 * function and otherwise just sit there with no visible change while the
 * request is in flight. `pointerEvents="auto"` is deliberate: it blocks
 * taps getting through to the screen underneath (no double-submits), not
 * just a decoration.
 *
 * One object per call site, not the full six-object cycle — this is
 * covering a single specific action (`archiving`, `analyzing`, ...), so a
 * static, on-topic sketch reads better than the plan-generation loader's
 * "long unpredictable wait" cycling.
 */
export function LoadingOverlay({
  visible, object, label,
}: {
  visible: boolean;
  object: SketchKey;
  label?: string;
}) {
  const { dir } = useLanguage();
  if (!visible) return null;
  return (
    <View
      pointerEvents="auto"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: 'rgba(6,7,10,0.72)', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
      ]}
    >
      <SketchLoader size={84} objects={[object]} orbit={false} stroke={3.2} label={label} dir={dir} />
    </View>
  );
}
