import { useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button } from './ui';
import { colors, font, radius, spacing } from '../theme';

// Signature data stored on the order: the drawing surface size + the stroke
// paths (SVG path "d" strings), so it can be re-rendered at any size later.
export interface SignatureData {
  w: number;
  h: number;
  paths: string[];
}

/**
 * Full-screen-ish modal that pops up after the customer confirms their order.
 * They sign with a finger; onConfirm returns the serialized signature.
 */
export function SignatureModal({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (signature: string) => void;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>('');
  const sizeRef = useRef({ w: 0, h: 0 });

  const reset = () => {
    setPaths([]);
    setCurrent('');
  };

  const onLayout = (e: LayoutChangeEvent) => {
    sizeRef.current = {
      w: e.nativeEvent.layout.width,
      h: e.nativeEvent.layout.height,
    };
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          const { locationX, locationY } = e.nativeEvent;
          setCurrent(`M${locationX.toFixed(1)},${locationY.toFixed(1)}`);
        },
        onPanResponderMove: (e: GestureResponderEvent) => {
          const { locationX, locationY } = e.nativeEvent;
          setCurrent((c) => `${c} L${locationX.toFixed(1)},${locationY.toFixed(1)}`);
        },
        onPanResponderRelease: () => {
          setCurrent((c) => {
            if (c) setPaths((p) => [...p, c]);
            return '';
          });
        },
      }),
    []
  );

  const hasSignature = paths.length > 0 || current.length > 0;

  const confirm = () => {
    const data: SignatureData = {
      w: sizeRef.current.w,
      h: sizeRef.current.h,
      paths: current ? [...paths, current] : paths,
    };
    onConfirm(JSON.stringify(data));
    reset();
  };

  const cancel = () => {
    reset();
    onCancel();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Sign to confirm</Text>
          <Text style={styles.subtitle}>Please sign below to place your order.</Text>

          <View style={styles.padWrap} onLayout={onLayout} {...responder.panHandlers}>
            {!hasSignature ? <Text style={styles.hint}>Sign here</Text> : null}
            <Svg style={StyleSheet.absoluteFill}>
              {paths.map((d, i) => (
                <Path key={i} d={d} stroke={colors.text} strokeWidth={2.5} fill="none" />
              ))}
              {current ? (
                <Path d={current} stroke={colors.text} strokeWidth={2.5} fill="none" />
              ) : null}
            </Svg>
            <View style={styles.signLine} />
          </View>

          <Pressable onPress={reset} style={styles.clearBtn}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>

          <Button title="Place order" onPress={confirm} disabled={!hasSignature} />
          <View style={{ height: spacing.sm }} />
          <Button title="Back" variant="ghost" onPress={cancel} />
        </View>
      </View>
    </Modal>
  );
}

/** Renders a stored signature (read-only) at a given height. */
export function SignatureView({ data, height = 120 }: { data: string; height?: number }) {
  let parsed: SignatureData | null = null;
  try {
    parsed = JSON.parse(data) as SignatureData;
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.paths.length === 0) return null;
  const vb = `0 0 ${parsed.w || 300} ${parsed.h || 150}`;
  return (
    <View style={[styles.viewBox, { height }]}>
      <Svg width="100%" height="100%" viewBox={vb} preserveAspectRatio="xMidYMid meet">
        {parsed.paths.map((d, i) => (
          <Path key={i} d={d} stroke={colors.text} strokeWidth={2.5} fill="none" />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.xl,
  },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.body, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  padWrap: {
    height: 220,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: '#fff',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: { color: colors.textMuted, fontSize: font.h3 },
  signLine: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 40,
    height: 1,
    backgroundColor: colors.border,
  },
  clearBtn: { alignSelf: 'flex-end', padding: spacing.sm, marginBottom: spacing.sm },
  clearText: { color: colors.primary, fontWeight: '700', fontSize: font.body },
  viewBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: '#fff',
  },
});
