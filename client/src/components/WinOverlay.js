"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import confetti from "canvas-confetti";
import { useWebSocket } from "@/lib/useWebSocket";

const DISPLAY_DURATION_MS = 3_000;
const TEST_MODE = false;
const TEST_INTERVAL_MS = 5_000;


export function WinOverlay() {
  const { events } = useWebSocket("orchestrator");
  const [visible, setVisible] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const prevLen = useRef(0);
  const timerRef = useRef(null);

  const fireConfetti = useCallback(() => {
    // confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0, y: 1 }, colors: ["#4ade80", "#22c55e", "#16a34a", "#bbf7d0"] });
    // confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1, y: 1 }, colors: ["#4ade80", "#22c55e", "#16a34a", "#bbf7d0"] });
    setTimeout(() => {
      confetti({ particleCount: 150, spread: 150, origin: { x: 0.52, y: 0.55 }, colors: ["#4ade80", "#22c55e", "#ffffff", "#fbbf24"] });
    }, 500);
  }, []);

  const show = useCallback(() => {
    clearTimeout(timerRef.current);
    setAnimKey((k) => k + 1);
    setVisible(true);
    fireConfetti();
    timerRef.current = setTimeout(() => setVisible(false), DISPLAY_DURATION_MS);
  }, [fireConfetti]);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  // --- test loop ---
  useEffect(() => {
    if (!TEST_MODE) return;
    show(); 
    const iv = setInterval(() => {
      show();
    }, TEST_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [show]);
  // --- end test loop ---

  useEffect(() => {
    if (events.length <= prevLen.current) {
      prevLen.current = events.length;
      return;
    }

    const newEvents = events.slice(prevLen.current);
    prevLen.current = events.length;

    for (const evt of newEvents) {
      if (evt?.event !== "bot_status" || evt?.data?.status !== "resolved") continue;

      const botId = evt.data.botId;
      if (!botId) continue;

      fetch(`/api/bots/${botId}`)
        .then((res) => res.ok && res.json())
        .then((bot) => {
          if (!bot) return;
          const verdict = bot.verdict?.result ?? bot.verdict;
          if (verdict !== "WIN") return;
          show();
        })
        .catch(() => {});
    }
  }, [events, show]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none" >
      <img
        key={animKey}
        src="/win.png"
        alt="WIN"
        onClick={dismiss}
        className="pointer-events-auto animate-win max-w-lg w-full drop-shadow-[0_0_40px_rgba(74,222,128,0.4)] cursor-pointer"
      />
    </div>
  );
}
