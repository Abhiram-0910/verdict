import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Report } from './pages/Report';
import { Landing } from './pages/Landing';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/audit/:id" element={<Report />} />
        <Route path="*" element={
          <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300">
            <h1 className="text-4xl font-bold mb-4 text-slate-100">Verdict MVP</h1>
            <p className="text-slate-400 mb-8 max-w-md text-center">
              The landing page is not built yet. Navigate directly to <code className="bg-slate-800 px-2 py-1 rounded">/audit/&lt;uuid&gt;</code> to view a report.
            </p>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
