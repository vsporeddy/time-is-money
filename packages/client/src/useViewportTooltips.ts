import { useEffect } from 'react';

const TOOLTIP_SELECTOR = [
  '.inventory-tooltip',
  '.trait-progress-tooltip',
  '.attribute-bonus-tooltip',
  '.special-modifier-tooltip',
  '.how-to-play-tooltip',
].join(', ');

const VIEWPORT_GUTTER = 8;

/**
 * Preserve each tooltip's CSS anchor, then nudge the rendered card just enough
 * to keep it within the visible browser viewport.
 */
export function useViewportTooltips() {
  useEffect(() => {
    let animationFrame = 0;

    const clampVisibleTooltips = () => {
      animationFrame = 0;

      document.querySelectorAll<HTMLElement>(TOOLTIP_SELECTOR).forEach((tooltip) => {
        // Clear the previous correction before measuring in case the viewport or
        // the tooltip's contents changed since it was last shown.
        tooltip.style.translate = '';

        const styles = window.getComputedStyle(tooltip);
        if (styles.display === 'none' || styles.visibility === 'hidden') return;

        const rect = tooltip.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;

        let shiftX = 0;
        let shiftY = 0;

        if (rect.left < VIEWPORT_GUTTER) {
          shiftX = VIEWPORT_GUTTER - rect.left;
        } else if (rect.right > viewportWidth - VIEWPORT_GUTTER) {
          shiftX = viewportWidth - VIEWPORT_GUTTER - rect.right;
        }

        if (rect.top < VIEWPORT_GUTTER) {
          shiftY = VIEWPORT_GUTTER - rect.top;
        } else if (rect.bottom > viewportHeight - VIEWPORT_GUTTER) {
          shiftY = viewportHeight - VIEWPORT_GUTTER - rect.bottom;
        }

        if (shiftX || shiftY) {
          tooltip.style.translate = `${shiftX}px ${shiftY}px`;
        }
      });
    };

    const scheduleClamp = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(clampVisibleTooltips);
    };

    // Capture handles tooltips revealed by either mouse hover or keyboard focus.
    document.addEventListener('pointerover', scheduleClamp, true);
    document.addEventListener('focusin', scheduleClamp, true);
    window.addEventListener('resize', scheduleClamp);
    window.addEventListener('scroll', scheduleClamp, true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('pointerover', scheduleClamp, true);
      document.removeEventListener('focusin', scheduleClamp, true);
      window.removeEventListener('resize', scheduleClamp);
      window.removeEventListener('scroll', scheduleClamp, true);
    };
  }, []);
}
