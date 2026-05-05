import ReactDOM from "react-dom/client";
import { Dashboard } from "./Dashboard";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Popup root element not found.");
}

ReactDOM.createRoot(rootElement).render(<Dashboard mode="popup" />);
