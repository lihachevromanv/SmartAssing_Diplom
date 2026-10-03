import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.tsx';
import Layout from './components/Layout.tsx';
import { Spinner } from './components/ui.tsx';
import Board from './pages/Board.tsx';
import Dashboard from './pages/Dashboard.tsx';
import Distribution from './pages/Distribution.tsx';
import Experiment from './pages/Experiment.tsx';
import Login from './pages/Login.tsx';
import Settings from './pages/Settings.tsx';
import Tasks from './pages/Tasks.tsx';
import Team from './pages/Team.tsx';

export default function App() {
  const { user, loading, isManager } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="board" element={<Board />} />
        <Route path="team" element={<Team />} />
        {isManager && (
          <>
            <Route path="distribution" element={<Distribution />} />
            <Route path="experiment" element={<Experiment />} />
            <Route path="settings" element={<Settings />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
