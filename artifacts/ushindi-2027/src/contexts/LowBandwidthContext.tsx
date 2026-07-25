import { createContext, useContext, useState } from "react";

interface LowBandwidthContextType {
  lowBandwidth: boolean;
  toggleLowBandwidth: () => void;
}

const LowBandwidthContext = createContext<LowBandwidthContextType>({
  lowBandwidth: false,
  toggleLowBandwidth: () => {},
});

export function LowBandwidthProvider({ children }: { children: React.ReactNode }) {
  const [lowBandwidth, setLowBandwidth] = useState<boolean>(() => {
    try {
      return localStorage.getItem("lm_lowbw") === "1";
    } catch {
      return false;
    }
  });

  const toggleLowBandwidth = () => {
    setLowBandwidth((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("lm_lowbw", next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  return (
    <LowBandwidthContext.Provider value={{ lowBandwidth, toggleLowBandwidth }}>
      {children}
    </LowBandwidthContext.Provider>
  );
}

export const useLowBandwidth = () => useContext(LowBandwidthContext);
