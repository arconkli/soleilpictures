import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { AuthGate } from './auth/AuthGate.jsx';
import { FeedbackProvider } from './components/AppFeedback.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FeedbackProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </FeedbackProvider>
  </StrictMode>
);
