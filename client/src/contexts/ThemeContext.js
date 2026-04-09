import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

function getSystemTheme() {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const ThemeProvider = ({ children }) => {
  // Get theme from localStorage or default to 'dark'
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'system') ? savedTheme : 'dark';
  });

  // Resolved theme: when 'system', use OS/browser preference
  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;

  useEffect(() => {
    const applyTheme = (effective) => {
      document.documentElement.setAttribute('data-theme', effective);
      const favicon = document.querySelector('link[rel="icon"]');
      if (favicon) {
        const base = typeof process !== 'undefined' && process.env?.PUBLIC_URL ? process.env.PUBLIC_URL : '';
        favicon.href = effective === 'light' ? `${base}/favicon-light.ico` : `${base}/favicon.ico`;
      }
      let themeColor = document.querySelector('meta[name="theme-color"]');
      if (!themeColor) {
        themeColor = document.createElement('meta');
        themeColor.setAttribute('name', 'theme-color');
        document.head.appendChild(themeColor);
      }
      themeColor.setAttribute('content', effective === 'light' ? '#ffffff' : '#0f0e1a');
    };

    applyTheme(resolvedTheme);
    localStorage.setItem('theme', theme);
  }, [theme, resolvedTheme]);

  // Listen for system preference changes when using system theme
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const effective = mq.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', effective);
      const favicon = document.querySelector('link[rel="icon"]');
      if (favicon) {
        const base = typeof process !== 'undefined' && process.env?.PUBLIC_URL ? process.env.PUBLIC_URL : '';
        favicon.href = effective === 'light' ? `${base}/favicon-light.ico` : `${base}/favicon.ico`;
      }
      const themeColor = document.querySelector('meta[name="theme-color"]');
      if (themeColor) {
        themeColor.setAttribute('content', effective === 'light' ? '#ffffff' : '#0f0e1a');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => {
      if (prevTheme === 'system') return getSystemTheme() === 'dark' ? 'light' : 'dark';
      return prevTheme === 'dark' ? 'light' : 'dark';
    });
  };

  const setThemeValue = (value) => {
    if (value === 'dark' || value === 'light' || value === 'system') setTheme(value);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeValue, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

