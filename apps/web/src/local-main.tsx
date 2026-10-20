import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LocalApp } from "./local/LocalApp";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Local UI root is missing");

createRoot(root).render(
  <StrictMode>
    <LocalApp />
  </StrictMode>,
);
