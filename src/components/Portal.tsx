import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Portal renders children directly under document.body, bypassing any
// parent stacking context (so modals/popovers can never be trapped
// behind dashboard cards). The portal mounts only on the client.

type Props = {
  children: ReactNode;
  // When true, also lock <body> scrolling while mounted.
  lockScroll?: boolean;
};

export default function Portal({ children, lockScroll = true }: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.body);
  }, []);

  useEffect(() => {
    if (!lockScroll) return;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    document.body.style.overflow = "hidden";
    // iOS Safari fix: prevent rubber-band scrolling under the backdrop.
    document.body.style.position = "fixed";
    document.body.style.width = "100%";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.width = "";
    };
  }, [lockScroll]);

  if (!host) return null;
  return createPortal(children, host);
}
