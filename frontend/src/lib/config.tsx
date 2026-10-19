import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api } from "./api";

interface Config {
  tz: string;
  usdInr: string;
  loaded: boolean;
  reload: () => void;
}

const ConfigCtx = createContext<Config>({
  tz: "Asia/Kolkata",
  usdInr: "",
  loaded: false,
  reload: () => {},
});

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [tz, setTz] = useState("Asia/Kolkata");
  const [usdInr, setUsdInr] = useState("");
  const [loaded, setLoaded] = useState(false);

  function reload() {
    api
      .getSettings()
      .then((s) => {
        setTz((s.display_timezone as string) || "Asia/Kolkata");
        setUsdInr((s.usd_inr_rate as string) || "");
      })
      .finally(() => setLoaded(true));
  }

  useEffect(reload, []);

  return (
    <ConfigCtx.Provider value={{ tz, usdInr, loaded, reload }}>{children}</ConfigCtx.Provider>
  );
}

export const useConfig = () => useContext(ConfigCtx);
