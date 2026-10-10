import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
// A notification can navigate to a new hash while the same client stays mounted.
export function useClientSectionRefresh(
  section: string,
  refresh: () => Promise<void>,
) {
  const location = useLocation();
  const navigation = `${location.key}:${location.hash}`;
  const previous = useRef(navigation);
  useEffect(() => {
    if (previous.current === navigation) return;
    previous.current = navigation;
    if (location.hash === section) void refresh();
  }, [navigation, location.hash, section, refresh]);
}
