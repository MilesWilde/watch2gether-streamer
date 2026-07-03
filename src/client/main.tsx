import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WatchPartyApp } from "./WatchPartyApp";

const root = document.querySelector("#root");

if (!root) {
	throw new Error("Missing React root element.");
}

createRoot(root).render(
	<StrictMode>
		<WatchPartyApp />
	</StrictMode>
);
