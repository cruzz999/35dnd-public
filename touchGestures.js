// touchGestures.js
// Two-finger pan and pinch-to-zoom controller.
// Intentionally isolated from ink internals and app-specific logic.

(function (global) {
  const TouchGestures = {};

  TouchGestures.install = function installTouchGestures(options) {
    const {
      viewport,
      enabled = true,
      getPan,
      setPan,
      getZoom,
      setZoom,
      clampZoom,
      onTransformChanged
    } = options || {};

    if (!enabled || !viewport) {
      return { destroy() {} };
    }

    const gesture = {
      pointers: new Map(), // pointerId -> { clientX, clientY }
      active: false,
      startDistance: 0,
      startZoom: 1,
      anchorWorld: { x: 0, y: 0 }
    };

    function getViewportLocalPoint(clientX, clientY) {
      const vr = viewport.getBoundingClientRect();
      return {
        x: clientX - vr.left,
        y: clientY - vr.top
      };
    }

    function getTouchPointsArray() {
      return Array.from(gesture.pointers.values());
    }

    function getDistance(p1, p2) {
      const dx = p2.clientX - p1.clientX;
      const dy = p2.clientY - p1.clientY;
      return Math.hypot(dx, dy);
    }

    function getMidpointLocal(p1, p2) {
      const midClientX = (p1.clientX + p2.clientX) / 2;
      const midClientY = (p1.clientY + p2.clientY) / 2;
      return getViewportLocalPoint(midClientX, midClientY);
    }

    function beginGesture() {
      const pts = getTouchPointsArray();
      if (pts.length < 2) return;

      const p1 = pts[0];
      const p2 = pts[1];

      const mid = getMidpointLocal(p1, p2);
      const dist = getDistance(p1, p2);

      if (!Number.isFinite(dist) || dist <= 0) return;

      const pan = getPan();
      const zoom = getZoom();

      gesture.active = true;
      gesture.startDistance = dist;
      gesture.startZoom = zoom;

      gesture.anchorWorld = {
        x: (mid.x - pan.x) / zoom,
        y: (mid.y - pan.y) / zoom
      };
    }

    function updateGesture() {
      if (!gesture.active) return;

      const pts = getTouchPointsArray();
      if (pts.length < 2) return;

      const p1 = pts[0];
      const p2 = pts[1];

      const mid = getMidpointLocal(p1, p2);
      const dist = getDistance(p1, p2);

      if (!Number.isFinite(dist) || dist <= 0 || !Number.isFinite(gesture.startDistance) || gesture.startDistance <= 0) {
        return;
      }

      const rawScale = dist / gesture.startDistance;

      // Safer / calmer pinch behavior:
      const pinchDelta = rawScale - 1;
      const deadZone = 0.04;
      let adjustedScale = 1;

      if (Math.abs(pinchDelta) > deadZone) {
        const beyondDeadZone =
          pinchDelta > 0
            ? pinchDelta - deadZone
            : pinchDelta + deadZone;

        const damping = 0.35;
        adjustedScale = Math.pow(1 + beyondDeadZone, damping);
      }

      const newZoom = clampZoom(gesture.startZoom * adjustedScale);

      setZoom(newZoom);
      setPan({
        x: mid.x - gesture.anchorWorld.x * newZoom,
        y: mid.y - gesture.anchorWorld.y * newZoom
      });

      if (typeof onTransformChanged === "function") {
        onTransformChanged();
      }
    }

    function endGestureIfNeeded() {
      if (gesture.pointers.size < 2) {
        gesture.active = false;
        gesture.startDistance = 0;
      }
    }

    function onPointerDown(e) {
      if (e.pointerType !== "touch") return;

      gesture.pointers.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY
      });

      try { viewport.setPointerCapture?.(e.pointerId); } catch {}

      if (gesture.pointers.size === 2) {
        beginGesture();
      }
    }

    function onPointerMove(e) {
      if (e.pointerType !== "touch") return;
      if (!gesture.pointers.has(e.pointerId)) return;

      gesture.pointers.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY
      });

      if (gesture.pointers.size >= 2) {
        if (!gesture.active) beginGesture();
        updateGesture();
        e.preventDefault();
      }
    }

    function onPointerFinish(e) {
      if (e.pointerType !== "touch") return;

      gesture.pointers.delete(e.pointerId);

      try { viewport.releasePointerCapture?.(e.pointerId); } catch {}

      endGestureIfNeeded();
    }

    viewport.addEventListener("pointerdown", onPointerDown, { passive: false });
    viewport.addEventListener("pointermove", onPointerMove, { passive: false });
    viewport.addEventListener("pointerup", onPointerFinish);
    viewport.addEventListener("pointercancel", onPointerFinish);

    return {
      destroy() {
        viewport.removeEventListener("pointerdown", onPointerDown);
        viewport.removeEventListener("pointermove", onPointerMove);
        viewport.removeEventListener("pointerup", onPointerFinish);
        viewport.removeEventListener("pointercancel", onPointerFinish);
      }
    };
  };

  global.TouchGestures = TouchGestures;
})(window);
