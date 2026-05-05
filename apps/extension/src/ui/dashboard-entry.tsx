import ReactDOM from "react-dom/client";
import { Dashboard } from "./Dashboard";
import { ErrorBoundary } from "./dashboard/ErrorBoundary";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Dashboard root element not found.");
}

ReactDOM.createRoot(rootElement).render(
  <ErrorBoundary>
    <Dashboard mode="dashboard" />
  </ErrorBoundary>,
);
