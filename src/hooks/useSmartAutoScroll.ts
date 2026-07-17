import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_FOLLOW_THRESHOLD_PX = 120;

export function useSmartAutoScroll(
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const lastScrollTop = useRef(0);

  const checkPosition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <
      AUTO_FOLLOW_THRESHOLD_PX;
    setIsAtBottom(atBottom);
    if (!atBottom && el.scrollHeight > lastScrollTop.current) {
      setShowJumpButton(true);
    }
    lastScrollTop.current = el.scrollHeight;
  }, [containerRef]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setIsAtBottom(true);
    setShowJumpButton(false);
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkPosition, { passive: true });
    return () => el.removeEventListener("scroll", checkPosition);
  }, [checkPosition]);

  return { isAtBottom, showJumpButton, scrollToBottom };
}
