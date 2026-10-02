/**
 * KeyHaven routes. Nested-route (layout-route) pattern: `Layout` renders
 * `<Outlet/>`, so every page is a nested `<Route>` of the layout route.
 * Do NOT wrap routes as children of <Layout> — never mix the two patterns.
 */

import { Routes, Route } from 'react-router';
import Layout from '@/components/Layout';
import Home from '@/pages/Home';
import Unlock from '@/pages/Unlock';
import Vault from '@/pages/Vault';
import Security from '@/pages/Security';
import Generator from '@/pages/Generator';
import Settings from '@/pages/Settings';
import Subscriptions from '@/pages/Subscriptions';
import About from '@/pages/About';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="unlock" element={<Unlock />} />
        <Route path="vault" element={<Vault />} />
        <Route path="subscriptions" element={<Subscriptions />} />
        <Route path="security" element={<Security />} />
        <Route path="generator" element={<Generator />} />
        <Route path="settings" element={<Settings />} />
        <Route path="about" element={<About />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}
