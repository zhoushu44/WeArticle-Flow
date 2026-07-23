import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home, { ErrorBoundary } from "@/pages/Home";

export default function App() {
  return (
    <ErrorBoundary>
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/other" element={<div className="text-center text-xl">Other Page - Coming Soon</div>} />
      </Routes>
    </Router>
    </ErrorBoundary>
  );
}
