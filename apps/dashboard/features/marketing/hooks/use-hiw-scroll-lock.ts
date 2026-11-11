"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const STEP_MS = 450;
const ENTRY_MS = 280;
const UNLOCK_COOLDOWN_MS = 900;
const WHEEL_THRESHOLD = 12;
const APPROACH_PAD = 32;
const EXIT_PAD = 64;

type ReadyState = "ssr" | "booting" | "true" | "reduce";

type LockMeta = {
  scrollY: number;
  sectionTop: number;
  sectionHeight: number;
  maxScroll: number;
};

type ExitIntent = "down" | "up" | null;

export function useHiwScrollLock(
  sectionRef: RefObject<HTMLElement | null>,
  stepCount: number,
) {
  const [step, setStep] = useState(0);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<ReadyState>("ssr");

  const lockMetaRef = useRef<LockMeta>({
    scrollY: 0,
    sectionTop: 0,
    sectionHeight: 0,
    maxScroll: 0,
  });
  const stepRef = useRef(0);
  const lockedRef = useRef(false);
  const busyRef = useRef(false);
  const allowStepRef = useRef(true);
  const reducedRef = useRef(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const cooldownRef = useRef(false);
  const exitIntentRef = useRef<ExitIntent>(null);

  const syncDataset = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (lockedRef.current) root.dataset.hiwLocked = "true";
    else delete root.dataset.hiwLocked;
    if (busyRef.current || !allowStepRef.current) root.dataset.hiwBusy = "true";
    else delete root.dataset.hiwBusy;
    const counter = root.querySelector<HTMLElement>("[data-hiw-counter]");
    if (counter) {
      counter.dataset.hiwStep = String(stepRef.current + 1);
      counter.textContent = `${stepRef.current + 1} / ${stepCount}`;
    }
  }, [stepCount]);

  const captureLockMeta = useCallback(
    (scrollY: number) => {
      const section = sectionRef.current;
      const sectionTop = section?.offsetTop ?? scrollY;
      const sectionHeight = section?.offsetHeight ?? window.innerHeight;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      lockMetaRef.current = { scrollY, sectionTop, sectionHeight, maxScroll };
    },
    [sectionRef],
  );

  const applyBodyLock = useCallback((scrollY: number) => {
    captureLockMeta(scrollY);
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
  }, [captureLockMeta]);

  const releaseBodyLock = useCallback((scrollY: number) => {
    const y = Math.max(0, Math.round(scrollY));
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.overflow = "";
    // html has scroll-smooth: without the instant restore the smooth scroll starts from 0 (page top).
    window.scrollTo({ top: lockMetaRef.current.scrollY, behavior: "instant" });
    window.scrollTo({ top: y, behavior: "smooth" });
  }, []);

  const lock = useCallback(
    (scrollY: number, initialStep: number) => {
      if (lockedRef.current || reducedRef.current || cooldownRef.current) return;
      exitIntentRef.current = null;
      applyBodyLock(scrollY);
      lockedRef.current = true;
      allowStepRef.current = false;
      stepRef.current = initialStep;
      setLocked(true);
      setStep(initialStep);
      syncDataset();
      window.setTimeout(() => {
        allowStepRef.current = true;
        syncDataset();
      }, ENTRY_MS);
    },
    [applyBodyLock, syncDataset],
  );

  const unlock = useCallback(
    (targetScrollY: number, intent: ExitIntent) => {
      if (!lockedRef.current) return;
      lockedRef.current = false;
      busyRef.current = false;
      allowStepRef.current = true;
      cooldownRef.current = true;
      exitIntentRef.current = intent;
      setLocked(false);
      setBusy(false);
      syncDataset();
      releaseBodyLock(targetScrollY);
      window.setTimeout(() => {
        cooldownRef.current = false;
        exitIntentRef.current = null;
      }, UNLOCK_COOLDOWN_MS);
    },
    [releaseBodyLock, syncDataset],
  );

  const exitDown = useCallback(() => {
    const { scrollY, sectionHeight, maxScroll } = lockMetaRef.current;
    const exitY = Math.min(maxScroll, scrollY + sectionHeight + EXIT_PAD);
    unlock(exitY, "down");
  }, [unlock]);

  const exitUp = useCallback(() => {
    const { scrollY } = lockMetaRef.current;
    const exitY = Math.max(0, scrollY - window.innerHeight + EXIT_PAD);
    unlock(exitY, "up");
  }, [unlock]);

  const gotoStep = useCallback(
    (next: number) => {
      if (busyRef.current || !allowStepRef.current) return;
      if (next < 0 || next >= stepCount || next === stepRef.current) return;
      busyRef.current = true;
      allowStepRef.current = false;
      setBusy(true);
      stepRef.current = next;
      setStep(next);
      syncDataset();
      window.setTimeout(() => {
        busyRef.current = false;
        allowStepRef.current = true;
        setBusy(false);
        syncDataset();
      }, STEP_MS);
    },
    [stepCount, syncDataset],
  );

  const tryLockFromScroll = useCallback(
    (direction: "down" | "up") => {
      if (lockedRef.current || reducedRef.current || cooldownRef.current) return;
      if (exitIntentRef.current === direction) return;

      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight;

      if (direction === "down") {
        if (rect.bottom < vh * 0.35) return;
        if (rect.top <= 1 && rect.top >= -APPROACH_PAD && rect.bottom > vh * 0.55) {
          lock(window.scrollY + rect.top, 0);
        }
        return;
      }

      if (rect.top > vh * 0.35) return;
      if (rect.top <= -APPROACH_PAD && rect.top >= -vh && rect.bottom > vh * 0.75) {
        lock(window.scrollY + rect.top, stepCount - 1);
      }
    },
    [lock, sectionRef, stepCount],
  );

  const bindRoot = useCallback(
    (node: HTMLElement | null) => {
      rootRef.current = node;
      if (!node) return;
      node.dataset.hiwReady = ready;
      syncDataset();
    },
    [ready, syncDataset],
  );

  useEffect(() => {
    setReady("booting");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reducedRef.current = reduced;
    if (reduced) {
      stepRef.current = stepCount - 1;
      setStep(stepCount - 1);
      setReady("reduce");
      return;
    }
    setReady("true");
  }, [stepCount]);

  useEffect(() => {
    if (reducedRef.current) return;

    let lastScrollY = window.scrollY;

    const onScroll = () => {
      if (lockedRef.current) return;
      const y = window.scrollY;
      const direction = y > lastScrollY ? "down" : "up";
      lastScrollY = y;
      tryLockFromScroll(direction);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [tryLockFromScroll]);

  useEffect(() => {
    if (reducedRef.current) return;

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < WHEEL_THRESHOLD) return;

      if (lockedRef.current) {
        event.preventDefault();
        if (busyRef.current || !allowStepRef.current) return;

        if (event.deltaY > 0) {
          if (stepRef.current >= stepCount - 1) {
            exitDown();
            return;
          }
          gotoStep(stepRef.current + 1);
          return;
        }

        if (stepRef.current <= 0) {
          exitUp();
          return;
        }
        gotoStep(stepRef.current - 1);
        return;
      }

      const section = sectionRef.current;
      if (!section || cooldownRef.current) return;
      const rect = section.getBoundingClientRect();

      if (event.deltaY > 0) {
        if (rect.top > 0) {
          const nextTop = rect.top - event.deltaY;
          if (nextTop <= APPROACH_PAD) {
            event.preventDefault();
            lock(window.scrollY + rect.top, 0);
          }
        }
        return;
      }

      if (event.deltaY < 0 && rect.top < -APPROACH_PAD) {
        const nextTop = rect.top - event.deltaY;
        if (nextTop >= -APPROACH_PAD) {
          event.preventDefault();
          lock(window.scrollY + rect.top, stepCount - 1);
        }
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [exitDown, exitUp, gotoStep, lock, sectionRef, stepCount]);

  useEffect(() => {
    if (reducedRef.current) return;

    let touchStartY = 0;
    let touchDelta = 0;

    const onTouchStart = (event: TouchEvent) => {
      if (!lockedRef.current) return;
      touchStartY = event.touches[0]?.clientY ?? 0;
      touchDelta = 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!lockedRef.current) return;
      event.preventDefault();
      const y = event.touches[0]?.clientY ?? touchStartY;
      touchDelta += touchStartY - y;
      touchStartY = y;

      if (Math.abs(touchDelta) < 48) return;
      if (busyRef.current || !allowStepRef.current) {
        touchDelta = 0;
        return;
      }

      if (touchDelta > 0) {
        touchDelta = 0;
        if (stepRef.current >= stepCount - 1) {
          exitDown();
          return;
        }
        gotoStep(stepRef.current + 1);
        return;
      }

      touchDelta = 0;
      if (stepRef.current <= 0) {
        exitUp();
        return;
      }
      gotoStep(stepRef.current - 1);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, [exitDown, exitUp, gotoStep, stepCount]);

  useEffect(() => {
    return () => {
      if (!lockedRef.current) return;
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    syncDataset();
    if (rootRef.current) rootRef.current.dataset.hiwReady = ready;
  }, [step, locked, busy, ready, syncDataset]);

  return {
    step,
    locked,
    busy,
    ready,
    reducedMotion: ready === "reduce",
    bindRoot,
  };
}
