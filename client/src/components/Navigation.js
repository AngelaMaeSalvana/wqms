import React, {useState,useEffect} from 'react'
import './components.css';
import { useTheme } from '../contexts/ThemeContext';

const Navigation = () => {
    
    const [dateTime, setDateTime] = useState(new Date());
    const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const timer = setInterval(() => setDateTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: true,
    timeZone: "Asia/Manila",
  })
    .format(dateTime)
    .replace(" at", ""); 

  return (
    <div className='Navigation'>
        <div className='logo'>
            <p>Water Quality Monitoring System</p>
        </div>
        <div className="nav-actions">
          <div className='datetime'>
              <p>{formattedDate}</p>
          </div>
          <button 
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
    </div>
  )
}

export default Navigation;
