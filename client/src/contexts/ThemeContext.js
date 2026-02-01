import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  // Get theme from localStorage or default to 'dark'
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme || 'dark';
  });

  useEffect(() => {
    // Apply theme class to root element
    document.documentElement.setAttribute('data-theme', theme);
    // Save theme preference to localStorage
    localStorage.setItem('theme', theme);

    // Favicon: use theme-specific favicon so tab icon matches light/dark
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) {
      const base = typeof process !== 'undefined' && process.env?.PUBLIC_URL ? process.env.PUBLIC_URL : '';
      favicon.href = theme === 'light' ? `${base}/favicon-light.ico` : `${base}/favicon.ico`;
    }

    // theme-color meta for browser chrome (mobile/desktop)
    let themeColor = document.querySelector('meta[name="theme-color"]');
    if (!themeColor) {
      themeColor = document.createElement('meta');
      themeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(themeColor);
    }
    themeColor.setAttribute('content', theme === 'light' ? '#ffffff' : '#0f0e1a');
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'dark' ? 'light' : 'dark');
  };

  const setThemeValue = (value) => {
    if (value === 'dark' || value === 'light') setTheme(value);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeValue, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

