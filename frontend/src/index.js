import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import TravelAuthority from './components/TravelAuthority';
import Appointment from './components/Appointment';
import PageNotFound from './404-Page-3';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} /> {/* Home route for Employee Management */}
      <Route path="/travel-authority" element={<TravelAuthority />} /> {/* Travel Authority Management */}
      <Route path="/appointment" element={<Appointment />} /> {/* Appointment Management */}
      <Route path="*" element={<PageNotFound />} /> {/* Catch-all route for 404 errors */}
    </Routes>
  </BrowserRouter>
);