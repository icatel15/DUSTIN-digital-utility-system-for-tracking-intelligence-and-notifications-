import { NavLink, Outlet } from "react-router-dom";

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "phantom-dark" ? "phantom-light" : "phantom-dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("phantom-theme", next);
}

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <nav className="navbar bg-base-200/90 border-b border-base-300 px-4 sm:px-6 sticky top-0 z-50 backdrop-blur-md">
        <div className="navbar-start gap-2 sm:gap-3">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-primary-content text-xs font-bold">
            D
          </div>
          <span className="font-semibold text-base hidden sm:inline">DUSTIN</span>
          <span className="text-base-content/20 hidden sm:inline">/</span>
          <span className="text-sm text-base-content/60">Dashboard</span>
        </div>
        <div className="navbar-center hidden sm:flex">
          <div className="flex gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `btn btn-sm btn-ghost ${isActive ? "btn-active" : ""}`
              }
            >
              Overview
            </NavLink>
            <NavLink
              to="/config"
              className={({ isActive }) =>
                `btn btn-sm btn-ghost ${isActive ? "btn-active" : ""}`
              }
            >
              Config
            </NavLink>
          </div>
        </div>
        <div className="navbar-end">
          <button
            className="btn btn-sm btn-ghost btn-circle"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile nav */}
      <div className="sm:hidden flex border-b border-base-300 bg-base-200/50">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex-1 text-center py-2 text-sm ${isActive ? "text-primary border-b-2 border-primary font-medium" : "text-base-content/60"}`
          }
        >
          Overview
        </NavLink>
        <NavLink
          to="/config"
          className={({ isActive }) =>
            `flex-1 text-center py-2 text-sm ${isActive ? "text-primary border-b-2 border-primary font-medium" : "text-base-content/60"}`
          }
        >
          Config
        </NavLink>
      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
