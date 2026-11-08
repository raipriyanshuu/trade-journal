import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ConfigProvider } from "./lib/config";
import { ThemeProvider } from "./lib/theme";
import { SegmentProvider } from "./lib/segment";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ConfigProvider>
          <SegmentProvider>
            <App />
          </SegmentProvider>
        </ConfigProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
