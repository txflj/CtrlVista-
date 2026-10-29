import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.jsx';
import './ui/theme.css';
import './ui/rhine-workbench.css';
import './ui/appearance.css';
import { applyColorTheme, getColorThemeStorage, readColorTheme } from './app/color-theme.mjs';

applyColorTheme(document.documentElement, readColorTheme(getColorThemeStorage()));
createRoot(document.getElementById('root')).render(<App />);
