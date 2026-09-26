import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import Feed from "./pages/Feed";
import Idea from "./pages/Idea";

export default function App() {
  return (
    <BrowserRouter>
      <header className="header">
        <Link to="/" className="brand">
          🔥 Idea Roaster
        </Link>
        <span className="tagline">Post your startup idea. Get it roasted.</span>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Feed />} />
          <Route path="/idea/:id" element={<Idea />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
