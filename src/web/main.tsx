import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { composeWeb } from './composition-root.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');

createRoot(container).render(<StrictMode>{composeWeb().root}</StrictMode>);
