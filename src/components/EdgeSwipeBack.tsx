import { PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { useAppTheme } from '../store/ThemeContext';

type EdgeSwipeBackProps = PropsWithChildren<{
  onBack: () => void;
  style?: StyleProp<ViewStyle>;
}>;

type SwipeIntent = 'undecided' | 'horizontal' | 'vertical';

const EDGE_WIDTH = 12;
const START_DISTANCE = 72;
const CLOSE_DISTANCE = 280;
const TRACK_HORIZONTAL_RATIO = 16;
const CLOSE_HORIZONTAL_RATIO = 20;
const MAX_VERTICAL_DRIFT = 5;

export function EdgeSwipeBack({ children, onBack, style }: EdgeSwipeBackProps) {
  const { colors } = useAppTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeIntent = useRef<SwipeIntent>('undecided');
  const [leaving, setLeaving] = useState(false);

  const resetPosition = useCallback(() => {
    setLeaving(false);
    swipeIntent.current = 'undecided';
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
        .activeOffsetX(72)
        .failOffsetY([-8, 8])
        .onBegin(() => {
          swipeIntent.current = 'undecided';
          if (!leaving) translateX.stopAnimation();
        })
        .onUpdate((event) => {
          if (leaving) return;
          const horizontalDistance = event.translationX;
          const verticalDistance = Math.abs(event.translationY);

          if (horizontalDistance <= 0 || swipeIntent.current === 'vertical') {
            translateX.setValue(0);
            return;
          }

          const isTooDiagonal =
            verticalDistance > MAX_VERTICAL_DRIFT ||
            horizontalDistance < verticalDistance * TRACK_HORIZONTAL_RATIO;
          if (isTooDiagonal) {
            swipeIntent.current = 'vertical';
            translateX.setValue(0);
            return;
          }

          if (swipeIntent.current !== 'horizontal') {
            if (
              horizontalDistance <= START_DISTANCE ||
              horizontalDistance < verticalDistance * TRACK_HORIZONTAL_RATIO
            ) {
              translateX.setValue(0);
              return;
            }
            swipeIntent.current = 'horizontal';
          }

          translateX.setValue(Math.min(horizontalDistance - START_DISTANCE, Dimensions.get('window').width));
        })
        .onEnd((event) => {
          if (leaving) return;
          const horizontalDistance = event.translationX;
          const verticalDistance = Math.abs(event.translationY);
          const isHorizontalSwipe = horizontalDistance > verticalDistance * CLOSE_HORIZONTAL_RATIO;
          const shouldClose =
            swipeIntent.current === 'horizontal' &&
            isHorizontalSwipe &&
            horizontalDistance > CLOSE_DISTANCE;
          if (shouldClose) {
            close();
            return;
          }
          cancelSwipe();
        })
        .onFinalize(() => {
          swipeIntent.current = 'undecided';
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

