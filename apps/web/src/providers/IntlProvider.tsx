"use client";

import { NextIntlClientProvider } from "next-intl";
import { useState, createContext, useContext } from "react";
import enMessages from "../messages/en.json";

const messages = { en: enMessages };
type Locale = keyof typeof messages;

// oxlint-disable-next-line typescript/no-empty-function
const noop = () => {};

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
}>({ locale: "en", setLocale: noop });

export function useLocale() {
  return useContext(LocaleContext);
}

export function IntlProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "en";
    const stored = localStorage.getItem("locale") as Locale | null;
    return stored && messages[stored] ? stored : "en";
  });

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("locale", newLocale);
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <NextIntlClientProvider locale={locale} messages={messages[locale]}>
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
