import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./AdminApp";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Admin root is missing");

createRoot(root).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
