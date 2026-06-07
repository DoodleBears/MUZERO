import { useEffect, useState } from "react";
import type { ChatMode } from "@/stores/chat-store";

const MOBILE_QUERY = "(max-width: 767px)";

export function resolveChatModeForViewport(mode: ChatMode, isMobile: boolean): ChatMode {
  return mode === "dock" && isMobile ? "fullscreen" : mode;
}

export function useChatBreakpoint() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" || !window.matchMedia
      ? false
      : window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return { isMobile };
}
