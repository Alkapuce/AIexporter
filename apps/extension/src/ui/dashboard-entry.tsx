import ReactDOM from "react-dom/client";
import { Dashboard } from "./Dashboard";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Dashboard root element not found.");
}

ReactDOM.createRoot(rootElement).render(<Dashboard mode="dashboard" />);
