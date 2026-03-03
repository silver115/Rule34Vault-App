/**
 * ZoomableImage — pinch-to-zoom + free pan for images in the post detail view.
 *
 * Web:    mouse-wheel zoom · click-drag pan · two-finger pinch touch
 * Native: two-finger pinch zoom · one-finger pan when zoomed
 */
import { Image } from "expo-image";
import React, { useCallback, useRef } from "react";
import {
    Animated,
    PanResponder,
    Platform,
    StyleSheet,
} from "react-native";

interface ZoomableImageProps {
  uri: string;
  width: number;
  height: number;
  onError?: () => void;
  onLoad?: () => void;
}

// ─── Web implementation ───────────────────────────────────────────────────────

function ZoomableImageWeb({ uri, width, height, onError, onLoad }: ZoomableImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scale = useRef(1);
  const tx = useRef(0);
  const ty = useRef(0);
  // for mouse drag
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  // for touch pinch
  const pinchStart = useRef<{ dist: number; scale: number; cx: number; cy: number; tx: number; ty: number } | null>(null);

  const MIN_SCALE = 1;
  const MAX_SCALE = 8;

  function applyTransform() {
    const el = containerRef.current?.querySelector("img") as HTMLElement | null;
    if (!el) return;
    el.style.transform = `scale(${scale.current}) translate(${tx.current / scale.current}px, ${ty.current / scale.current}px)`;
  }

  function clampTranslate(s: number, nx: number, ny: number) {
    const maxX = (width * (s - 1)) / 2;
    const maxY = (height * (s - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, nx)),
      y: Math.max(-maxY, Math.min(maxY, ny)),
    };
  }

  function resetZoom() {
    scale.current = 1;
    tx.current = 0;
    ty.current = 0;
    applyTransform();
  }

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale.current * delta));
    // zoom toward cursor
    const rect = containerRef.current!.getBoundingClientRect();
    const ox = e.clientX - rect.left - width / 2;
    const oy = e.clientY - rect.top - height / 2;
    const scaleFactor = newScale / scale.current;
    const clamped = clampTranslate(
      newScale,
      (tx.current + ox) * scaleFactor - ox,
      (ty.current + oy) * scaleFactor - oy
    );
    scale.current = newScale;
    tx.current = clamped.x;
    ty.current = clamped.y;
    applyTransform();
  }, [width, height]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale.current <= 1) return;
    dragStart.current = { x: e.clientX, y: e.clientY, tx: tx.current, ty: ty.current };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    const clamped = clampTranslate(
      scale.current,
      dragStart.current.tx + dx,
      dragStart.current.ty + dy
    );
    tx.current = clamped.x;
    ty.current = clamped.y;
    applyTransform();
  }, []);

  const onMouseUp = useCallback(() => { dragStart.current = null; }, []);

  // Touch pinch
  function getTouchDist(t1: React.Touch, t2: React.Touch) {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchStart.current = {
        dist: getTouchDist(e.touches[0], e.touches[1]),
        scale: scale.current,
        cx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        cy: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        tx: tx.current,
        ty: ty.current,
      };
    } else if (e.touches.length === 1 && scale.current > 1) {
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: tx.current, ty: ty.current };
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStart.current) {
      e.preventDefault();
      const newDist = getTouchDist(e.touches[0], e.touches[1]);
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStart.current.scale * (newDist / pinchStart.current.dist)));
      const rect = containerRef.current!.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const ox = cx - rect.left - width / 2;
      const oy = cy - rect.top - height / 2;
      const scaleFactor = newScale / pinchStart.current.scale;
      const clamped = clampTranslate(
        newScale,
        (pinchStart.current.tx + ox) * scaleFactor - ox,
        (pinchStart.current.ty + oy) * scaleFactor - oy
      );
      scale.current = newScale;
      tx.current = clamped.x;
      ty.current = clamped.y;
      applyTransform();
    } else if (e.touches.length === 1 && dragStart.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - dragStart.current.x;
      const dy = e.touches[0].clientY - dragStart.current.y;
      const clamped = clampTranslate(scale.current, dragStart.current.tx + dx, dragStart.current.ty + dy);
      tx.current = clamped.x;
      ty.current = clamped.y;
      applyTransform();
    }
  }, [width, height]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) pinchStart.current = null;
    if (e.touches.length === 0) dragStart.current = null;
    // snap back if below min
    if (scale.current < MIN_SCALE) resetZoom();
  }, []);

  return (
    // @ts-ignore — web-only div with ref
    <div
      ref={containerRef}
      style={{
        width,
        height,
        overflow: "hidden",
        position: "relative",
        cursor: scale.current > 1 ? "grab" : "default",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
      }}
      onWheel={onWheel as any}
      onMouseDown={onMouseDown as any}
      onMouseMove={onMouseMove as any}
      onMouseUp={onMouseUp as any}
      onMouseLeave={onMouseUp as any}
      onTouchStart={onTouchStart as any}
      onTouchMove={onTouchMove as any}
      onTouchEnd={onTouchEnd as any}
    >
      <img
        src={uri}
        style={{
          width,
          height,
          objectFit: "contain",
          display: "block",
          transformOrigin: "center center",
          willChange: "transform",
          pointerEvents: "none",
          draggable: false,
        } as any}
        onError={onError}
        onLoad={onLoad}
        draggable={false}
      />
    </div>
  );
}

// ─── Native implementation ────────────────────────────────────────────────────

function ZoomableImageNative({ uri, width, height, onError, onLoad }: ZoomableImageProps) {
  const MIN_SCALE = 1;
  const MAX_SCALE = 8;

  const animScale = useRef(new Animated.Value(1)).current;
  const animTX = useRef(new Animated.Value(0)).current;
  const animTY = useRef(new Animated.Value(0)).current;

  // raw values for gesture maths
  const curScale = useRef(1);
  const curTX = useRef(0);
  const curTY = useRef(0);

  // pinch start state
  const pinchInitDist = useRef(0);
  const pinchInitScale = useRef(1);

  // pan start state
  const panInitTX = useRef(0);
  const panInitTY = useRef(0);
  const panInitX = useRef(0);
  const panInitY = useRef(0);

  function clamp(val: number, maxAbs: number) {
    return Math.max(-maxAbs, Math.min(maxAbs, val));
  }

  function syncAnimated() {
    animScale.setValue(curScale.current);
    animTX.setValue(curTX.current);
    animTY.setValue(curTY.current);
  }

  function snapBack() {
    if (curScale.current < MIN_SCALE) {
      curScale.current = MIN_SCALE;
      curTX.current = 0;
      curTY.current = 0;
      Animated.spring(animScale, { toValue: MIN_SCALE, useNativeDriver: true }).start();
      Animated.spring(animTX, { toValue: 0, useNativeDriver: true }).start();
      Animated.spring(animTY, { toValue: 0, useNativeDriver: true }).start();
    } else {
      // clamp translation so image doesn't go off screen
      const maxX = (width * (curScale.current - 1)) / 2;
      const maxY = (height * (curScale.current - 1)) / 2;
      curTX.current = clamp(curTX.current, maxX);
      curTY.current = clamp(curTY.current, maxY);
      syncAnimated();
    }
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => {
        return evt.nativeEvent.touches.length >= 2;
      },
      onMoveShouldSetPanResponder: (evt, _gs) => {
        if (evt.nativeEvent.touches.length >= 2) return true;
        // capture single-finger drag only when zoomed in
        return curScale.current > 1.01;
      },
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const dx = touches[1].pageX - touches[0].pageX;
          const dy = touches[1].pageY - touches[0].pageY;
          pinchInitDist.current = Math.hypot(dx, dy);
          pinchInitScale.current = curScale.current;
        } else {
          panInitTX.current = curTX.current;
          panInitTY.current = curTY.current;
          panInitX.current = touches[0].pageX;
          panInitY.current = touches[0].pageY;
        }
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const dx = touches[1].pageX - touches[0].pageX;
          const dy = touches[1].pageY - touches[0].pageY;
          const dist = Math.hypot(dx, dy);
          const newScale = Math.max(
            0.8,
            Math.min(MAX_SCALE, pinchInitScale.current * (dist / Math.max(1, pinchInitDist.current)))
          );
          curScale.current = newScale;
          animScale.setValue(newScale);
        } else if (touches.length === 1 && curScale.current > 1.01) {
          const dx = touches[0].pageX - panInitX.current;
          const dy = touches[0].pageY - panInitY.current;
          const maxX = (width * (curScale.current - 1)) / 2;
          const maxY = (height * (curScale.current - 1)) / 2;
          curTX.current = clamp(panInitTX.current + dx, maxX);
          curTY.current = clamp(panInitTY.current + dy, maxY);
          animTX.setValue(curTX.current);
          animTY.setValue(curTY.current);
        }
      },
      onPanResponderRelease: snapBack,
      onPanResponderTerminate: snapBack,
    })
  ).current;

  return (
    <Animated.View
      style={[
        styles.nativeContainer,
        { width, height },
        {
          transform: [
            { scale: animScale },
            { translateX: animTX },
            { translateY: animTY },
          ],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Image
        source={{ uri }}
        style={{ width, height }}
        contentFit="contain"
        cachePolicy="memory-disk"
        onError={onError}
        onLoad={onLoad}
      />
    </Animated.View>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function ZoomableImage(props: ZoomableImageProps) {
  if (Platform.OS === "web") return <ZoomableImageWeb {...props} />;
  return <ZoomableImageNative {...props} />;
}

const styles = StyleSheet.create({
  nativeContainer: {
    overflow: "hidden",
  },
});
