import { createContext, useContext, useState } from "react";

export type Lang = "en" | "sw";

interface LanguageContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (en: string, sw?: string | null) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: "en",
  setLang: () => {},
  t: (en) => en,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return (localStorage.getItem("lm_lang") as Lang) || "en";
    } catch {
      return "en";
    }
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("lm_lang", l);
    } catch {}
  };

  const t = (en: string, sw?: string | null) =>
    lang === "sw" && sw ? sw : en;

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
