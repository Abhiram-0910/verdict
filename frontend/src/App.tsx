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
          <div className="min-h-screen bg-paper flex flex-col items-center justify-center text-ink/70">
            <h1 className="text-4xl font-bold mb-4 text-ink">Verdict MVP</h1>
            <p className="mb-8 max-w-md text-center">
              The landing page is not built yet. Navigate directly to <code className="bg-line/50 text-ink font-mono px-2 py-1 rounded">/audit/&lt;uuid&gt;</code> to view a report.
            </p>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
