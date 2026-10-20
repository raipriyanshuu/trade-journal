import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import MarketDataTab from "../components/settings/MarketDataTab";
import InstrumentsTab from "../components/settings/InstrumentsTab";
import AccountsTab from "../components/settings/AccountsTab";
import PreferencesTab from "../components/settings/PreferencesTab";
import TagsTab from "../components/settings/TagsTab";
import RulesTab from "../components/settings/RulesTab";
import ChargesTab from "../components/settings/ChargesTab";
import AiTab from "../components/settings/AiTab";
import DemoTab from "../components/settings/DemoTab";

const TABS = [
  { key: "instruments", label: "Instruments" },
  { key: "accounts", label: "Accounts" },
  { key: "tags", label: "Tags" },
  { key: "rules", label: "Mistake rules" },
  { key: "charges", label: "India charges" },
  { key: "market", label: "Market data" },
  { key: "ai", label: "AI review" },
  { key: "preferences", label: "Preferences" },
  { key: "demo", label: "Demo Data" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function Settings() {
  const [params] = useSearchParams();
  const initial = TABS.find((t) => t.key === params.get("tab"))?.key ?? "instruments";
  const [tab, setTab] = useState<TabKey>(initial);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Settings</h1>
      <div className="flex gap-1 mb-6 border-b border-card-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t.key
                ? "border-accent text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "instruments" && <InstrumentsTab />}
      {tab === "accounts" && <AccountsTab />}
      {tab === "tags" && <TagsTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "charges" && <ChargesTab />}
      {tab === "market" && <MarketDataTab />}
      {tab === "ai" && <AiTab />}
      {tab === "preferences" && <PreferencesTab />}
      {tab === "demo" && <DemoTab />}
    </div>
  );
}
