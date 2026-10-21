import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nBootstrap } from "./components/I18nBootstrap";
import { LocalApp } from "./local/LocalApp";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Local UI root is missing");

createRoot(root).render(
  <StrictMode>
    <I18nBootstrap defaultLocale="zh-CN">
      <LocalApp />
    </I18nBootstrap>
  </StrictMode>,
);
