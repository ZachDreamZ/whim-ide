import { useCallback, useEffect, useState } from "react";

const AUTO_FOLLOW_THRESHOLD_PX = 120;

export function useSmartAutoScroll(
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setIsAtBottom(true);
    setShowJumpButton(false);
  }, [containerRef]);

  // Recompute position and decide whether to auto-follow or surface the jump button.
  const evaluate = useCallback(
    (autoFollowIfNearBottom: boolean) => {
      const el = containerRef.current;
      if (!el) return;
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distanceFromBottom < AUTO_FOLLOW_THRESHOLD_PX;
      setIsAtBottom(atBottom);
      if (atBottom) {
        if (autoFollowIfNearBottom) {
          el.scrollTop = el.scrollHeight;
        }
        setShowJumpButton(false);
      } else {
        setShowJumpButton(true);
      }
    },
    [containerRef]
  );

  // Follow new streamed content / height changes when the user is near the bottom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new MutationObserver(() => {
      // Auto-follow only when already near the bottom; otherwise surface jump button.
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      evaluate(distanceFromBottom < AUTO_FOLLOW_THRESHOLD_PX);
    });
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Catch async height changes (images, code blocks, markdown) that do not
    // always emit a character mutation.
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        const distanceFromBottom =
          el.scrollHeight - el.scrollTop - el.clientHeight;
        evaluate(distanceFromBottom < AUTO_FOLLOW_THRESHOLD_PX);
      });
      resizeObserver.observe(el);
    }

    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
    };
  }, [evaluate, containerRef]);

  // Track manual scrolling: pause auto-follow when the user scrolls up.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => evaluate(false);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [evaluate, containerRef]);

  return { isAtBottom, showJumpButton, scrollToBottom };
}
