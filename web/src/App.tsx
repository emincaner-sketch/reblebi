import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarDays, Inbox, LayoutDashboard, LogOut, Moon, PlugZap, Settings, Sun, Zap } from "lucide-react";
import { api, type Dashboard } from "./lib/api";
import LoginPage from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import ChannelsPage from "./pages/Channels";
import PostsPage from "./pages/Posts";
import ComposerPage from "./pages/Composer";
import InboxPage from "./pages/InboxPage";
import AutomationPage from "./pages/Automation";
import AnalyticsPage from "./pages/Analytics";
import SettingsPage from "./pages/SettingsPage";
import { useLocalState } from "./components/ui";

interface AuthStatus {
  needsSetup: boolean;
  user: { id: string; email: string } | null;
}

export default function App() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const auth = useQuery({ queryKey: ["auth"], queryFn: () => api.get<AuthStatus>("/api/auth/status"), staleTime: 60_000 });
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/api/dashboard"), enabled: Boolean(auth.data?.user), refetchInterval: 30_000 });
  const [theme, setTheme] = useLocalState<"dark" | "light">("sp_theme", "dark");

  if (auth.isLoading) return <div className="login">Yükleniyor…</div>;
  if (auth.isError) return <div className="login"><div className="card">API'ye ulaşılamıyor. Sunucu çalışıyor mu? (<code>npm run dev</code>)</div></div>;
  if (!auth.data?.user) return <LoginPage needsSetup={Boolean(auth.data?.needsSetup)} onDone={() => qc.invalidateQueries({ queryKey: ["auth"] })} />;

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
  };

  const logout = async () => {
    await api.post("/api/auth/logout");
    qc.clear();
    nav("/");
    qc.invalidateQueries({ queryKey: ["auth"] });
  };

  const attention = dash.data?.inbox.attention ?? 0;
  const unread = dash.data?.inbox.unread ?? 0;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">S</div>
          <div>
            <div className="brand-name">SosyalPilot</div>
            <div className="brand-sub">Sosyal medya otomasyonu</div>
          </div>
        </div>
        <NavLink to="/" end className="nav-link"><LayoutDashboard /> Panel</NavLink>
        <NavLink to="/kanallar" className="nav-link"><PlugZap /> Kanallar {dash.data && dash.data.channels.problem > 0 && <span className="nav-badge">{dash.data.channels.problem}</span>}</NavLink>
        <NavLink to="/gonderiler" className="nav-link"><CalendarDays /> Gönderiler & Takvim</NavLink>
        <NavLink to="/gelen-kutusu" className="nav-link"><Inbox /> Gelen Kutusu {(attention > 0 || unread > 0) && <span className="nav-badge">{attention > 0 ? attention : unread}</span>}</NavLink>
        <NavLink to="/otomasyon" className="nav-link"><Zap /> Otomasyon</NavLink>
        <NavLink to="/analitik" className="nav-link"><BarChart3 /> Analitik</NavLink>
        <NavLink to="/ayarlar" className="nav-link"><Settings /> Ayarlar</NavLink>
        <div className="sidebar-footer">
          <div className="row-between">
            <span className="truncate" title={auth.data.user.email}>{auth.data.user.email}</span>
            <button className="btn btn-ghost btn-icon" onClick={toggleTheme} title="Tema">{theme === "dark" ? <Sun /> : <Moon />}</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={logout}><LogOut /> Çıkış</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/kanallar" element={<ChannelsPage />} />
          <Route path="/gonderiler" element={<PostsPage />} />
          <Route path="/gonderiler/yeni" element={<ComposerPage />} />
          <Route path="/gonderiler/:id" element={<ComposerPage />} />
          <Route path="/gelen-kutusu" element={<InboxPage />} />
          <Route path="/gelen-kutusu/:id" element={<InboxPage />} />
          <Route path="/otomasyon" element={<AutomationPage />} />
          <Route path="/analitik" element={<AnalyticsPage />} />
          <Route path="/ayarlar" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
