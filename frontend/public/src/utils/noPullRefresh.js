// Prevent mobile pull-to-refresh.
//
// Chrome/Android honors CSS `overscroll-behavior-y: contain` (set in App.css),
// but iOS Safari ignores it. On iOS the pull-to-refresh gesture fires when the
// page is already scrolled to the very top and the user drags *down*. We block
// exactly that gesture: a downward touchmove while scrollTop <= 0.
//
// Normal in-page scrolling is untouched — we only preventDefault when the drag
// would otherwise overscroll past the top of the document.

export function installNoPullToRefresh() {
  if (typeof window === 'undefined') return;

  let startY = 0;

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
  };

  const onTouchMove = (e) => {
    if (e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - startY; // > 0 means dragging down
    const atTop = (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
    // Only block the overscroll-at-top downward pull. cancelable guards against
    // passive-listener warnings on gestures the browser already committed.
    if (atTop && dy > 0 && e.cancelable) {
      e.preventDefault();
    }
  };

  // touchmove must be non-passive so preventDefault() actually takes effect.
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
}
