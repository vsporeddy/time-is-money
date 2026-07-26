import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { loadPanelOffset, savePanelOffset } from './panelPositions';
import type { PanelOffset } from './panelPositions';

const VIEWPORT_GUTTER = 8;

// Anything focusable or clickable in the heading keeps its own behaviour — the
// close button and the hoverable score total both live there.
const INTERACTIVE_SELECTOR = 'button, a, input, [tabindex]';

interface DragStart {
  pointerX: number;
  pointerY: number;
  offset: PanelOffset;
  // The panel's rect with the drag offset removed, i.e. where its CSS anchor
  // alone would put it. Measured once per drag so clamping stays cheap.
  baseLeft: number;
  baseTop: number;
  width: number;
  height: number;
}

function clampAxis(delta: number, basePosition: number, size: number, viewport: number): number {
  const min = VIEWPORT_GUTTER - basePosition;
  const max = viewport - VIEWPORT_GUTTER - (basePosition + size);
  // Panels taller/wider than the viewport can't satisfy both edges; keep the
  // top-left corner visible so the heading stays grabbable.
  return Math.max(Math.min(delta, max), min);
}

export interface PanelDrag<T extends HTMLElement> {
  panelRef: RefObject<T>;
  panelStyle: CSSProperties | undefined;
  headingProps: {
    className: string;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  dragging: boolean;
}

/**
 * Lets a panel be dragged by its heading bar. The offset is applied through the
 * individual `translate` property rather than `transform` so the panel's CSS
 * anchors (centering, the mobile bottom anchor, modal flex centering) survive.
 */
export function usePanelDrag<T extends HTMLElement = HTMLElement>(
  storageKey: string,
  defaultOffset?: PanelOffset
): PanelDrag<T> {
  const panelRef = useRef<T>(null);
  const [offset, setOffset] = useState<PanelOffset>(
    () => loadPanelOffset(storageKey) ?? defaultOffset ?? { x: 0, y: 0 }
  );
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef(offset);
  const startRef = useRef<DragStart | null>(null);

  const applyOffset = useCallback((next: PanelOffset) => {
    offsetRef.current = next;
    setOffset(next);
  }, []);

  // A position stored at one window size can land off-screen at another, so
  // re-clamp on mount and whenever the viewport changes.
  useEffect(() => {
    let animationFrame = 0;

    const clampToViewport = () => {
      animationFrame = 0;
      const panel = panelRef.current;
      if (!panel) return;

      const current = offsetRef.current;
      if (current.x === 0 && current.y === 0) return;

      const rect = panel.getBoundingClientRect();
      const next = {
        x: clampAxis(current.x, rect.left - current.x, rect.width, document.documentElement.clientWidth),
        y: clampAxis(current.y, rect.top - current.y, rect.height, document.documentElement.clientHeight),
      };
      if (next.x !== current.x || next.y !== current.y) applyOffset(next);
    };

    const scheduleClamp = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(clampToViewport);
    };

    scheduleClamp();
    window.addEventListener('resize', scheduleClamp);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', scheduleClamp);
    };
  }, [applyOffset]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;

    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    const current = offsetRef.current;
    startRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offset: current,
      baseLeft: rect.left - current.x,
      baseTop: rect.top - current.y,
      width: rect.width,
      height: rect.height,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = startRef.current;
    if (!start) return;

    applyOffset({
      x: clampAxis(
        start.offset.x + (event.clientX - start.pointerX),
        start.baseLeft,
        start.width,
        document.documentElement.clientWidth
      ),
      y: clampAxis(
        start.offset.y + (event.clientY - start.pointerY),
        start.baseTop,
        start.height,
        document.documentElement.clientHeight
      ),
    });
  }, [applyOffset]);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!startRef.current) return;
    startRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    savePanelOffset(storageKey, offsetRef.current);
  }, [storageKey]);

  return {
    panelRef,
    // Skip the property entirely at rest: a non-none `translate` would make the
    // panel a containing block for its descendants.
    panelStyle: offset.x === 0 && offset.y === 0 ? undefined : { translate: `${offset.x}px ${offset.y}px` },
    headingProps: {
      className: 'inventory-heading inventory-heading-draggable',
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    dragging,
  };
}
