import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import TradeLog from "./pages/TradeLog";
import TradeDetail from "./pages/TradeDetail";
import Journal from "./pages/Journal";
import Mistakes from "./pages/Mistakes";
import Analytics from "./pages/Analytics";
import Calendar from "./pages/Calendar";
import PropTracker from "./pages/PropTracker";
import Data from "./pages/Data";
import Settings from "./pages/Settings";
import Reports from "./pages/Reports";
import Excursions from "./pages/Excursions";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="trades" element={<TradeLog />} />
        <Route path="trades/:id" element={<TradeDetail />} />
        <Route path="journal" element={<Journal />} />
        <Route path="mistakes" element={<Mistakes />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="prop" element={<PropTracker />} />
        <Route path="reports" element={<Reports />} />
        <Route path="excursions" element={<Excursions />} />
        <Route path="data" element={<Data />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
