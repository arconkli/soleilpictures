import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { AuthGate } from './auth/AuthGate.jsx';
import { FeedbackProvider } from './components/AppFeedback.jsx';
import { PublicBoardView } from './components/PublicBoardView.jsx';
import './styles.css';

// /share/<uuid> = public read-only viewer. Bypasses auth entirely so
// non-account-holders can preview a board without signing up. Any
// other path falls through to the normal app + auth gate.
const shareMatch = window.location.pathname.match(/^\/share\/([0-9a-f-]{36})\/?$/i);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FeedbackProvider>
      {shareMatch ? (
        <PublicBoardView token={shareMatch[1]} />
      ) : (
        <AuthGate>
          <App />
        </AuthGate>
      )}
    </FeedbackProvider>
  </StrictMode>
);
