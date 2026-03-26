import { Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Spinner from "./components/Spinner.jsx";

const WatchParty = lazy(() => import("./pages/WatchParty.jsx"));
const WatchParties = lazy(() => import("./pages/WatchParties.jsx"));

const App = () => {
  return (
    <Router>
      <Suspense
        fallback={
          <div className="min-h-screen bg-primary flex items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/parties" element={<WatchParties />} />
          <Route path="/party/:roomCode" element={<WatchParty />} />
        </Routes>
      </Suspense>
    </Router>
  );
};

export default App;
