import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "@livekit/components-styles";
import "./styles.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename="/skymeet">
      <Theme accentColor="green" grayColor="sage" radius="large">
        <App />
      </Theme>
    </BrowserRouter>
  </React.StrictMode>,
);
