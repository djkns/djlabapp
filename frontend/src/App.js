import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import DJLab from "@/pages/DJLab";
import { Toaster } from "sonner";

function App() {
  return (
    <div className="App dj-select-none">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<DJLab />} />
        </Routes>
      </BrowserRouter>
      <Toaster theme="dark" position="top-center" richColors />
    </div>
  );
}

export default App;
