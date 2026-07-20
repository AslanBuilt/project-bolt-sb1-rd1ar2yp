import { NavLink, Outlet } from 'react-router-dom';
import { Shirt, Calendar, History, Settings, PlusCircle, Sparkles } from 'lucide-react';

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        <h1 className="text-xl font-semibold text-slate-900">StyleCloset</h1>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
            A
          </div>
        </div>
      </header>

      <main className="flex-1 pb-20 overflow-y-auto">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-2 z-50">
        <div className="max-w-lg mx-auto flex justify-around items-center">
          <NavLink
            to="/today"
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
                isActive ? 'text-emerald-600' : 'text-slate-500'
              }`
            }
          >
            <Calendar size={22} />
            <span className="text-xs font-medium">Today</span>
          </NavLink>

          <NavLink
            to="/closet"
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
                isActive ? 'text-emerald-600' : 'text-slate-500'
              }`
            }
          >
            <Shirt size={22} />
            <span className="text-xs font-medium">Closet</span>
          </NavLink>

          <NavLink
            to="/add"
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
                isActive ? 'text-emerald-600' : 'text-slate-500'
              }`
            }
          >
            <PlusCircle size={22} />
            <span className="text-xs font-medium">Add</span>
          </NavLink>

          <NavLink
            to="/inspiration"
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
                isActive ? 'text-emerald-600' : 'text-slate-500'
              }`
            }
          >
            <Sparkles size={22} />
            <span className="text-xs font-medium">Inspo</span>
          </NavLink>

          <NavLink
            to="/history"
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
                isActive ? 'text-emerald-600' : 'text-slate-500'
              }`
            }
          >
            <History size={22} />
            <span className="text-xs font-medium">History</span>
          </NavLink>

          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
                isActive ? 'text-emerald-600' : 'text-slate-500'
              }`
            }
          >
            <Settings size={22} />
            <span className="text-xs font-medium">Settings</span>
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
