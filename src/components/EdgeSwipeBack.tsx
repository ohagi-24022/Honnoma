import { PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { useAppTheme } from '../store/ThemeContext';

type EdgeSwipeBackProps = PropsWithChildren<{
  onBack: () => void;
  style?: StyleProp<ViewStyle>;
}>;

const EDGE_WIDTH = 34;
const CLOSE_DISTANCE = 92;
const CLOSE_VELOCITY = 760;

export function EdgeSwipeBack({ children, onBack, style }: EdgeSwipeBackProps) {
  const { colors } = useAppTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const [leaving, setLeaving] = useState(false);

  const resetPosition = useCallback(() => {
    setLeaving(false);
    translateX.stopAnimation();
    translateX.setValue(0);
  }, [translateX]);

  useEffect(() => {
    resetPosition();
  }, [resetPosition]);

  const cancelSwipe = useCallback(() => {
    Animated.spring(translateX, {
      damping: 18,
      stiffness: 220,
      toValue: 0,
      useNativeDriver: true,
    }).start(() => setLeaving(false));
  }, [translateX]);

  const close = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    Animated.timing(translateX, {
      duration: 170,
      toValue: Dimensions.get('window').width,
      useNativeDriver: true,
    }).start(() => {
      onBack();
      requestAnimationFrame(() => {
        translateX.setValue(0);
        setLeaving(false);
      });
    });
  }, [leaving, onBack, translateX]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .hitSlop({ left: 0, width: EDGE_WIDTH })
        .activeOffsetX(8)
        .failOffsetY([-18, 18])
        .onBegin(() => {
          if (!leaving) translateX.stopAnimation();
        })
        .onUpdate((event) => {
          if (leaving) return;
          if (event.translationX <= 0) {
            translateX.setValue(0);
            return;
          }
          translateX.setValue(Math.min(event.translationX, Dimensions.get('window').width));
        })
        .onEnd((event) => {
          if (leaving) return;
          const shouldClose = event.translationX > CLOSE_DISTANCE || event.velocityX > CLOSE_VELOCITY;
          if (shouldClose) {
            close();
            return;
          }
          cancelSwipe();
        })
        .onFinalize(() => {
          if (leaving) return;
          translateX.stopAnimation((value) => {
            if (value > 0) cancelSwipe();
          });
        }),
    [cancelSwipe, close, leaving, translateX],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <View style={[styles.backdrop, { backgroundColor: colors.background }]}>
        <View style={[styles.backdropPanel, { backgroundColor: colors.surface, borderColor: colors.border }]} />
      </View>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            styles.content,
            style,
            {
              backgroundColor: colors.background,
              shadowColor: '#000000',
              shadowOffset: { height: 0, width: -3 },
              shadowOpacity: translateX.interpolate({
                inputRange: [0, 120],
                outputRange: [0, 0.18],
                extrapolate: 'clamp',
              }),
              shadowRadius: 12,
              transform: [{ translateX }],
            },
          ]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropPanel: {
    borderRightWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    opacity: 0.82,
    position: 'absolute',
    top: 0,
    width: 52,
  },
  content: { flex: 1 },
});
