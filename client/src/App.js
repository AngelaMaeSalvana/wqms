import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import GoogleMapReact from "google-map-react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import "./App.css";
import Navigation from "./components/Navigation.js";
import { useMQTT, useWaterQualityMQTT } from "./hooks/useMQTT.js";
import { useTheme } from "./contexts/ThemeContext.js";
import api from "./services/api.js";
import ErrorBoundary from "./components/ErrorBoundary.js";
import { useToast } from "./hooks/useToast.js";
import { ToastContainer } from "./components/Toast.js";
import ConnectionStatus from "./components/ConnectionStatus.js";
import EmptyState from "./components/EmptyState.js";
import { MetricSkeleton, ChartSkeleton, AlertSkeleton } from "./components/LoadingSkeleton.js";
import LastUpdated from "./components/LastUpdated.js";
import RefreshButton from "./components/RefreshButton.js";
import { useOffline } from "./hooks/useOffline.js";
import OfflineBanner from "./components/OfflineBanner.js";
import { exportToJSON, exportToCSV, formatReadingsForExport, formatAlertsForExport } from "./utils/exportData.js";
import { calculateWQI } from "./utils/wqiCalculator.js";

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const NodeMarker = ({ zoom, nodeId, onTestSensor, isTesting, testStatus }) => {
  const handleClick = () => {
    if (onTestSensor && !isTesting) {
      onTestSensor(nodeId);
    }
  };

  // Determine marker appearance based on test status
  let backgroundColor = "#1E88E5"; // Default blue
  let borderColor = "white";
  let animation = "none";
  let icon = nodeId || 1;
  let titleText = `Node ${nodeId || 1} - Click to test sensor`;

  if (isTesting) {
    backgroundColor = "#f0a500"; // Orange/yellow for testing
    borderColor = "#f0a500";
    animation = "nodeMarkerPulse 1.5s ease-in-out infinite";
    icon = "⚙️";
    titleText = `Node ${nodeId || 1} - Testing sensors...`;
  } else if (testStatus === 'error' || testStatus === 'failed') {
    backgroundColor = "#d45b5b"; // Red for failed
    borderColor = "#d45b5b";
    animation = "nodeMarkerPulse 2s ease-in-out infinite";
    icon = "⚠️";
    titleText = `Node ${nodeId || 1} - Sensor test failed`;
  } else if (testStatus === 'warning') {
    backgroundColor = "#f0a500"; // Orange for warning
    borderColor = "#f0a500";
    icon = "⚠️";
    titleText = `Node ${nodeId || 1} - Sensor test completed with warnings`;
  } else if (testStatus === 'success') {
    backgroundColor = "#44d37e"; // Green for success
    borderColor = "#44d37e";
    icon = "✓";
    titleText = `Node ${nodeId || 1} - Sensor test passed`;
  }

  return (
    <div
      style={{
        position: "absolute",
        transform: "translate(-50%, -50%)",
        zIndex: 20,
      }}
    >
        <button
        onClick={handleClick}
        className={isTesting ? "node-marker-testing" : testStatus === 'error' || testStatus === 'failed' ? "node-marker-failed" : ""}
          style={{
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          backgroundColor: backgroundColor,
            color: "white",
          border: `3px solid ${borderColor}`,
          boxShadow: isTesting 
            ? "0 0 12px rgba(240, 165, 0, 0.6)" 
            : testStatus === 'error' || testStatus === 'failed'
            ? "0 0 12px rgba(212, 91, 91, 0.6)"
            : "0 2px 8px rgba(0,0,0,0.3)",
          cursor: isTesting ? "wait" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: isTesting || testStatus ? "18px" : "16px",
          fontWeight: "700",
            transition: "all 0.2s ease",
          padding: 0,
          animation: animation,
        }}
        onMouseEnter={(e) => {
          if (!isTesting) {
            e.target.style.transform = "scale(1.1)";
            e.target.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isTesting) {
            e.target.style.transform = "scale(1)";
            e.target.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
          }
        }}
        disabled={isTesting}
        title={titleText}
        aria-label={titleText}
      >
        {icon}
        </button>
    </div>
  );
};

const App = () => {
  // MQTT Connection - connects to MQTT broker for live data streaming
  // System flow: Nodes → Microcontroller → MQTT Broker → Web Dashboard (Live Updates)
  const { client, isConnected, error, reconnect, isConnecting } = useMQTT();
  const { theme } = useTheme();
  const { toasts, showToast, removeToast } = useToast();
  const isOnline = useOffline();
  
  // Ref for scrollable chart container
  const chartScrollRef = useRef(null);
  
  // Loading states
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(true);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Real-time sensor data state (updated from MQTT)
  const [currentMetrics, setCurrentMetrics] = useState({
    temperature: null,
    turbidity: null,
    pH: null,
    nh3: null,
    dissolvedOxygen: null,
    wqi: null,
    location: null,
    nodeId: null,
  });

  // Real-time chart data state - store readings by minute with timestamps
  // Structure: [{ timestamp: Date, temperature: number, turbidity: number, pH: number }, ...]
  const [todayChartData, setTodayChartData] = useState([]);

  // Alerts state (can be updated via MQTT and API)
  const [alerts, setAlerts] = useState([]);

  // Fetch alerts from backend on mount
  const fetchAlerts = useCallback(async () => {
    setIsLoadingAlerts(true);
      try {
        const apiAlerts = await api.getAlerts({ limit: 10 });
        // Transform API alerts to match our format
        const formattedAlerts = apiAlerts.map(alert => ({
          id: alert.id,
          title: alert.title,
          detail: alert.detail,
          severity: alert.severity,
          createdAt: alert.timestamp || alert.created_at,
        }));
        setAlerts(formattedAlerts);
      setLastUpdated(new Date());
      showToast('Alerts loaded successfully', 'success', 2000);
      } catch (error) {
      console.warn('⚠️ Could not fetch alerts from API:', error);
      showToast('Failed to load alerts', 'error', 3000);
      setAlerts([]); // No fallback data - show empty state
    } finally {
      setIsLoadingAlerts(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchAlerts();
  }, []);

  // Refresh all data
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([fetchAlerts()]);
      showToast('Data refreshed successfully', 'success', 2000);
    } catch (error) {
      showToast('Failed to refresh data', 'error', 3000);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchAlerts, showToast]);

  // Export data functions
  const handleExportAlerts = (format = 'json') => {
    try {
      const formattedData = formatAlertsForExport(sortedAlerts);
      if (format === 'json') {
        exportToJSON(formattedData, 'alerts');
        showToast('Alerts exported as JSON', 'success', 2000);
      } else {
        exportToCSV(formattedData, 'alerts');
        showToast('Alerts exported as CSV', 'success', 2000);
      }
    } catch (error) {
      showToast('Failed to export alerts', 'error', 3000);
    }
  };

  const [isAlertsModalOpen, setIsAlertsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const alertsPerPage = 10;
  const [selectedWeeklyMetric, setSelectedWeeklyMetric] = useState("temperature");
  const [reportPeriod, setReportPeriod] = useState("week"); // "week" or "month"
  const [aggregationType, setAggregationType] = useState("average"); // "lowest", "average", "highest"
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarPosition, setCalendarPosition] = useState({ top: 0, left: 0 });
  
  // Default to current week (starting Sunday)
  const getDefaultDates = () => {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const diff = today.getDate() - dayOfWeek; // Go back to Sunday
    const sunday = new Date(today);
    sunday.setDate(diff);
    const saturday = new Date(sunday);
    saturday.setDate(saturday.getDate() + 6);
    return {
      start: sunday.toISOString().split('T')[0],
      end: saturday.toISOString().split('T')[0]
    };
  };
  
  const defaultDates = getDefaultDates();
  const [reportStartDate, setReportStartDate] = useState(defaultDates.start);
  const [reportEndDate, setReportEndDate] = useState(defaultDates.end);
  
  // Month selector state (for "By Month" period)
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth());
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());

  // Sort alerts by newest first
  const sortedAlerts = useMemo(() => {
    return [...alerts].sort((a, b) => {
      const da = new Date(a.createdAt || 0).getTime();
      const db = new Date(b.createdAt || 0).getTime();
      return db - da;
    });
  }, [alerts]);

  const recentAlerts = useMemo(() => sortedAlerts.slice(0, 10), [sortedAlerts]);

  // Pagination for modal
  const totalPages = Math.ceil(sortedAlerts.length / alertsPerPage);
  const paginatedAlerts = useMemo(() => {
    const startIndex = (currentPage - 1) * alertsPerPage;
    const endIndex = startIndex + alertsPerPage;
    return sortedAlerts.slice(startIndex, endIndex);
  }, [sortedAlerts, currentPage, alertsPerPage]);

  // Reset to page 1 when modal opens
  useEffect(() => {
    if (isAlertsModalOpen) {
      setCurrentPage(1);
    }
  }, [isAlertsModalOpen]);

  // Handle incoming MQTT data
  const handleMQTTData = async (data, topic) => {
    try {
      console.log('📨 MQTT message received:', topic, data);

      // Handle different data formats from MQTT topics
      // Expected topics: water-quality/node1, water-quality/node2, sensor-data/+, alerts/+

      // Extract node ID from topic (e.g., "water-quality/node1" → "node1")
      const nodeMatch = topic.match(/node(\d+)/i);
      const nodeId = nodeMatch ? nodeMatch[1] : data.nodeId || data.node || null;

      // Update current metrics
      if (data.temperature !== undefined || data.turbidity !== undefined || 
          data.pH !== undefined || data.ph !== undefined || data.wqi !== undefined) {
        
        // Calculate WQI from sensor parameters if not provided
        const temp = data.temperature ?? currentMetrics.temperature;
        const turb = data.turbidity ?? currentMetrics.turbidity;
        const ph = data.pH ?? data.ph ?? currentMetrics.pH;
        const ammonia = data.nh3 ?? data.NH3 ?? currentMetrics.nh3;
        const doValue = data.dissolvedOxygen ?? data.do ?? data.DO ?? currentMetrics.dissolvedOxygen;
        
        // Calculate WQI using the formula if we have sensor data
        let calculatedWQI = null;
        if (temp !== null && turb !== null && ph !== null && ammonia !== null && doValue !== null) {
          calculatedWQI = calculateWQI({
            temperature: temp,
            turbidity: turb,
            pH: ph,
            nh3: ammonia,
            dissolvedOxygen: doValue,
          });
        }
        
        // Use provided WQI if available, otherwise use calculated WQI
        const finalWQI = data.wqi !== undefined 
          ? Math.round(data.wqi) 
          : (data.WQI !== undefined 
            ? Math.round(data.WQI) 
            : (calculatedWQI !== null ? calculatedWQI : currentMetrics.wqi));
        
        setCurrentMetrics(prev => ({
          ...prev,
          temperature: temp,
          turbidity: turb,
          pH: ph,
          nh3: ammonia,
          dissolvedOxygen: doValue,
          wqi: finalWQI,
          location: data.location ?? prev.location,
          nodeId: nodeId ?? prev.nodeId,
        }));

        // Store reading with timestamp (minute-by-minute)
        const readingTimestamp = new Date();
        setTodayChartData(prev => {
          const newReading = {
            timestamp: readingTimestamp,
            temperature: temp !== null && temp !== undefined && !isNaN(temp) ? Number(temp) : null,
            turbidity: turb !== null && turb !== undefined && !isNaN(turb) ? Number(turb) : null,
            pH: ph !== null && ph !== undefined && !isNaN(ph) ? Number(ph) : null,
          };
          
          // Add new reading and keep only today's readings (last 24 hours)
          const updated = [...prev, newReading];
          const oneDayAgo = new Date();
          oneDayAgo.setHours(oneDayAgo.getHours() - 24);
          
          // Filter out readings older than 24 hours
          return updated.filter(reading => new Date(reading.timestamp) >= oneDayAgo);
        });

        // POST reading to backend database (optional - backend also receives from MQTT)
        // Include calculated WQI if available
        try {
          const readingToPost = {
            ...data,
            nodeId,
            timestamp: new Date().toISOString(),
          };
          
          // Add calculated WQI if we have it and it wasn't in the original data
          if (calculatedWQI !== null && data.wqi === undefined && data.WQI === undefined) {
            readingToPost.wqi = calculatedWQI;
          }
          
          await api.postReading(readingToPost);
          setLastUpdated(new Date());
        } catch (err) {
          console.warn('⚠️ Could not POST reading to backend:', err);
          if (!isOnline) {
            showToast('Offline: Reading saved locally', 'warning', 2000);
          }
        }
      }

      // Handle nested sensor reading format
      if (data.sensorReading) {
        const reading = data.sensorReading;
        
        // Calculate WQI from sensor parameters if not provided
        const temp = reading.temperature ?? currentMetrics.temperature;
        const turb = reading.turbidity ?? currentMetrics.turbidity;
        const ph = reading.pH ?? reading.ph ?? currentMetrics.pH;
        const ammonia = reading.nh3 ?? reading.NH3 ?? currentMetrics.nh3;
        const doValue = reading.dissolvedOxygen ?? reading.do ?? reading.DO ?? currentMetrics.dissolvedOxygen;
        
        // Calculate WQI using the formula if we have sensor data
        let calculatedWQI = null;
        if (temp !== null && turb !== null && ph !== null && ammonia !== null && doValue !== null) {
          calculatedWQI = calculateWQI({
            temperature: temp,
            turbidity: turb,
            pH: ph,
            nh3: ammonia,
            dissolvedOxygen: doValue,
          });
        }
        
        // Use provided WQI if available, otherwise use calculated WQI
        const finalWQI = reading.wqi !== undefined 
          ? Math.round(reading.wqi) 
          : (reading.WQI !== undefined 
            ? Math.round(reading.WQI) 
            : (calculatedWQI !== null ? calculatedWQI : currentMetrics.wqi));
        
        setCurrentMetrics(prev => ({
          ...prev,
          temperature: temp,
          turbidity: turb,
          pH: ph,
          nh3: ammonia,
          dissolvedOxygen: doValue,
          wqi: finalWQI,
          location: reading.location ?? prev.location,
          nodeId: reading.nodeId ?? reading.node ?? nodeId ?? prev.nodeId,
        }));

        // Store reading with timestamp (minute-by-minute)
        const readingTimestamp = new Date();
        setTodayChartData(prev => {
          const newReading = {
            timestamp: readingTimestamp,
            temperature: temp !== null && temp !== undefined && !isNaN(temp) ? Number(temp) : null,
            turbidity: turb !== null && turb !== undefined && !isNaN(turb) ? Number(turb) : null,
            pH: ph !== null && ph !== undefined && !isNaN(ph) ? Number(ph) : null,
          };
          
          // Add new reading and keep only today's readings (last 24 hours)
          const updated = [...prev, newReading];
          const oneDayAgo = new Date();
          oneDayAgo.setHours(oneDayAgo.getHours() - 24);
          
          // Filter out readings older than 24 hours
          return updated.filter(reading => new Date(reading.timestamp) >= oneDayAgo);
        });

        // POST reading to backend database
        // Include calculated WQI if available
        try {
          const readingToPost = {
            ...reading,
            nodeId: reading.nodeId ?? reading.node ?? nodeId,
            timestamp: new Date().toISOString(),
          };
          
          // Add calculated WQI if we have it and it wasn't in the original reading
          if (calculatedWQI !== null && reading.wqi === undefined && reading.WQI === undefined) {
            readingToPost.wqi = calculatedWQI;
          }
          
          await api.postReading(readingToPost);
          setLastUpdated(new Date());
        } catch (err) {
          console.warn('⚠️ Could not POST reading to backend:', err);
        }
      }

      // Handle alerts from MQTT
      if (topic.includes('alert') || data.alert) {
        const alert = data.alert || data;
        const createdAt = alert.createdAt || new Date().toISOString();
        const newAlert = {
          id: Date.now(),
          title: alert.title || 'New Alert',
          detail: alert.detail || alert.message || 'Alert received',
          severity: alert.severity || 'info',
          createdAt,
        };
        
        setAlerts(prev => [
          newAlert,
          ...prev.slice(0, 9), // Keep max 10 alerts
        ]);

        // POST alert to backend database
        try {
          await api.postAlert({
            ...alert,
            timestamp: createdAt,
          });
        } catch (err) {
          console.warn('⚠️ Could not POST alert to backend:', err);
        }
      }
    } catch (err) {
      console.error('❌ Error processing MQTT data:', err);
    }
  };

  // Subscribe to water quality MQTT topics
  useWaterQualityMQTT(client, handleMQTTData, [
    'water-quality/+',      // All water quality data (node1, node2, etc.)
    'sensor-data/+',        // Individual sensor readings
    'alerts/+',             // Alert notifications
  ]);

  // Poll for latest reading every minute to ensure dashboard updates
  useEffect(() => {
    const fetchLatestReading = async () => {
      try {
        const latestReading = await api.getLatestReading();
        if (latestReading) {
          // Calculate WQI if not provided
          const temp = latestReading.temperature ?? null;
          const turb = latestReading.turbidity ?? null;
          const ph = latestReading.pH ?? latestReading.ph ?? null;
          const ammonia = latestReading.nh3 ?? latestReading.NH3 ?? null;
          const doValue = latestReading.dissolvedOxygen ?? latestReading.do ?? latestReading.DO ?? null;
          
          let calculatedWQI = null;
          if (temp !== null && turb !== null && ph !== null && ammonia !== null && doValue !== null) {
            calculatedWQI = calculateWQI({
              temperature: temp,
              turbidity: turb,
              pH: ph,
              nh3: ammonia,
              dissolvedOxygen: doValue,
            });
          }
          
          const finalWQI = latestReading.wqi !== undefined
            ? Math.round(latestReading.wqi)
            : (latestReading.WQI !== undefined
              ? Math.round(latestReading.WQI)
              : (calculatedWQI !== null ? calculatedWQI : null));
          
          setCurrentMetrics(prev => ({
            ...prev,
            temperature: temp ?? prev.temperature,
            turbidity: turb ?? prev.turbidity,
            pH: ph ?? prev.pH,
            nh3: ammonia ?? prev.nh3,
            dissolvedOxygen: doValue ?? prev.dissolvedOxygen,
            wqi: finalWQI ?? prev.wqi,
            location: latestReading.location ?? prev.location,
            nodeId: latestReading.nodeId ?? latestReading.node ?? prev.nodeId,
          }));
          
          setLastUpdated(new Date());
        }
      } catch (error) {
        // Silently fail - MQTT is the primary data source
        console.debug('Could not fetch latest reading (this is normal if API is not available):', error.message);
      }
    };

    // Fetch immediately on mount
    fetchLatestReading();
    
    // Then fetch every minute (60000ms)
    const interval = setInterval(fetchLatestReading, 60000);
    
    return () => clearInterval(interval);
  }, []); // Empty dependency array - only run on mount and cleanup

  // WQI Classification based on ranges
  const getWQIClass = (wqi) => {
    if (wqi < 50) return { class: 'I', label: 'Excellent', quality: 'excellent' };
    if (wqi <= 100) return { class: 'II', label: 'Good', quality: 'good' };
    if (wqi <= 200) return { class: 'III', label: 'Poor', quality: 'poor' };
    if (wqi <= 300) return { class: 'IV', label: 'Very Poor', quality: 'very-poor' };
    return { class: 'V', label: 'Unsuitable', quality: 'unsuitable' };
  };

  // Removed deterministic data generation - only use real API data

  // Get detailed water quality metrics for a specific date
  // Returns: { date, wqi, qualityData, temperature, turbidity, pH, dissolvedOxygen, nh3 }
  const getDetailedMetricsForDate = async (date) => {
    if (!date) return null;
    
    const dateStr = date.toISOString().split('T')[0];
    let qualityData = null;
    let readingData = null;

    // Try to fetch from API first
    try {
      readingData = await api.getReadingByDate(dateStr);
      if (readingData && readingData.wqi !== null && readingData.wqi !== undefined) {
        qualityData = {
          wqi: Math.round(readingData.wqi),
          ...getWQIClass(readingData.wqi)
        };
      }
    } catch (error) {
      console.warn('⚠️ Could not fetch detailed metrics from API:', error);
    }

    // If no API data, return null (no fallback data)
    if (!qualityData) {
      return null;
    }

    // If we have reading data from API with all required fields, use it directly
    if (readingData && 
        readingData.temperature !== null && readingData.temperature !== undefined &&
        readingData.turbidity !== null && readingData.turbidity !== undefined &&
        readingData.ph !== null && readingData.ph !== undefined &&
        readingData.dissolved_oxygen !== null && readingData.dissolved_oxygen !== undefined &&
        readingData.nh3 !== null && readingData.nh3 !== undefined) {
      return {
        date,
        wqi: qualityData.wqi,
        qualityData,
        temperature: parseFloat(Number(readingData.temperature).toFixed(1)),
        turbidity: parseFloat(Number(readingData.turbidity).toFixed(1)),
        pH: parseFloat(Number(readingData.ph).toFixed(1)),
        dissolvedOxygen: parseFloat(Number(readingData.dissolved_oxygen).toFixed(1)),
        nh3: parseFloat(Number(readingData.nh3).toFixed(2)),
      };
    }

    // If we only have WQI but not all parameters, return what we have
    if (qualityData) {
    return {
      date,
      wqi: qualityData.wqi,
      qualityData,
        temperature: readingData?.temperature ?? null,
        turbidity: readingData?.turbidity ?? null,
        pH: readingData?.ph ?? null,
        dissolvedOxygen: readingData?.dissolved_oxygen ?? null,
        nh3: readingData?.nh3 ?? null,
    };
    }

    return null;
  };

  // Format date to short format e.g., "Dec 7, 2025 14:05"
  const formatDateShort = (dateString) => {
    if (!dateString) return "";
    const d = new Date(dateString);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  // Calendar state - defaults to current month
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize to midnight
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);
  const [isDateDetailsModalOpen, setIsDateDetailsModalOpen] = useState(false);
  const [selectedDateDetails, setSelectedDateDetails] = useState(null);
  
  // Sensor test modal state
  const [isSensorTestModalOpen, setIsSensorTestModalOpen] = useState(false);
  const [sensorTestResults, setSensorTestResults] = useState(null);
  const [isTestingSensor, setIsTestingSensor] = useState(false);

  // Manual input modal state

  // Keyboard shortcuts (must be after all state declarations)
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Ctrl/Cmd + R to refresh (prevent default browser refresh)
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        handleRefresh();
      }
      // Ctrl/Cmd + K to toggle theme
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        // Theme toggle is in Navigation component, so we'll skip this for now
      }
      // Escape to close modals
      if (e.key === 'Escape') {
        if (isAlertsModalOpen) setIsAlertsModalOpen(false);
        if (isDateDetailsModalOpen) setIsDateDetailsModalOpen(false);
        if (isSensorTestModalOpen) setIsSensorTestModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isAlertsModalOpen, isDateDetailsModalOpen, isSensorTestModalOpen, handleRefresh]);

  // Helper function to get stored test results for a node
  const getStoredTestResults = (nodeId) => {
    try {
      const key = `sensorTest_${nodeId}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        const data = JSON.parse(stored);
        const testDate = new Date(data.date);
        const today = normalizeDate(new Date());
        // Check if test was run today
        if (isSameDate(testDate, today)) {
          return data.results;
        }
      }
    } catch (error) {
      console.error('Error reading stored test results:', error);
    }
    return null;
  };

  // Helper function to store test results
  const storeTestResults = (nodeId, results) => {
    try {
      const key = `sensorTest_${nodeId}`;
      const data = {
        date: new Date().toISOString(),
        results: results
      };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error('Error storing test results:', error);
    }
  };

  // Generate sensor test results based on actual current metrics data
  const generateDummySensorTestResults = (nodeId) => {
    // Simulate sensor response times (80-150ms range)
    const getResponseTime = () => {
      const variation = Math.floor(Math.random() * 70) + 80;
      return `${variation}ms`;
    };

    // Generate sensor values based on current metrics - use exact values, no variation
    const getSensorValue = (sensorName, baseValue, unit) => {
      // If no current data, return N/A
      if (baseValue === null || baseValue === undefined || isNaN(baseValue)) {
        return 'N/A';
      }
      // Use exact value from currentMetrics, formatted to match display
      const decimals = sensorName === 'pH' ? 1 : sensorName === 'NH₃' ? 2 : 1;
      return baseValue.toFixed(decimals) + unit;
    };

    // Generate sensors based on actual current metrics data
    const sensorConfigs = [
      { name: 'Temperature Sensor', key: 'Temperature', unit: '°C', baseValue: currentMetrics.temperature },
      { name: 'Turbidity Sensor', key: 'Turbidity', unit: ' NTU', baseValue: currentMetrics.turbidity },
      { name: 'pH Sensor', key: 'pH', unit: '', baseValue: currentMetrics.pH },
      { name: 'Dissolved Oxygen Sensor', key: 'Dissolved Oxygen', unit: ' mg/L', baseValue: currentMetrics.dissolvedOxygen },
      { name: 'NH₃ Sensor', key: 'NH₃', unit: ' mg/L', baseValue: currentMetrics.nh3 },
    ];

    const sensors = sensorConfigs.map((config) => {
      const value = getSensorValue(config.key, config.baseValue, config.unit);
      const hasData = value !== 'N/A';
      
      // Determine sensor status based on data availability
      let status = 'pass';
      if (!hasData) {
        status = 'fail'; // Sensor has no data
      }
      
      return {
        name: config.name,
        status: status,
        value: value,
        responseTime: hasData ? getResponseTime() : 'Timeout'
      };
    });

    // Determine overall status based on actual data availability
    const hasFailures = sensors.some(s => s.status === 'fail');
    const missingDataCount = sensors.filter(s => s.value === 'N/A').length;
    
    let overallStatus = 'success';
    let message = 'Sensor test completed successfully';
    
    if (hasFailures) {
      // If any sensor has no data, status should be warning or error
      if (missingDataCount === sensors.length) {
        // All sensors failed
        overallStatus = 'error';
        message = 'All sensors failed - no data available';
      } else if (missingDataCount >= 2) {
        // Multiple sensors failed
        overallStatus = 'error';
        message = `${missingDataCount} sensors failed - missing data`;
      } else {
        // One sensor failed
        overallStatus = 'warning';
        message = 'Sensor test completed with warnings - some data unavailable';
      }
    }

    return {
      nodeId: nodeId,
      status: overallStatus,
      message: message,
      timestamp: new Date().toISOString(),
      sensors: sensors
    };
  };

  // Sensor test handler - checks if test was already run today
  const handleSensorTest = async (nodeId, forceRun = false) => {
    // Check if test was already run today
    if (!forceRun) {
      const storedResults = getStoredTestResults(nodeId);
      if (storedResults) {
        // Test already run today, just show results
        setSensorTestResults(storedResults);
        setIsSensorTestModalOpen(true);
        setIsTestingSensor(false);
        return;
      }
    }

    // Run new test
    setIsTestingSensor(true);
    setIsSensorTestModalOpen(true);
    
    try {
      // Publish test command to MQTT
      if (client && client.connected) {
        const testTopic = `sensor-test/node${nodeId}`;
        const testMessage = JSON.stringify({
          command: "test",
          nodeId: nodeId,
          timestamp: new Date().toISOString()
        });
        
        client.publish(testTopic, testMessage, { qos: 1 }, (err) => {
          if (err) {
            console.error('❌ Failed to publish sensor test:', err);
            const errorResults = {
              nodeId: nodeId,
              status: 'error',
              message: 'Failed to send test command',
              timestamp: new Date().toISOString(),
              sensors: []
            };
            setSensorTestResults(errorResults);
            storeTestResults(nodeId, errorResults);
            setIsTestingSensor(false);
          } else {
            console.log(`✅ Sensor test command sent to Node ${nodeId}`);
            // Simulate sensor test response with dummy data (in real implementation, this would come from MQTT)
            setTimeout(() => {
              const testResults = generateDummySensorTestResults(nodeId);
              setSensorTestResults(testResults);
              storeTestResults(nodeId, testResults);
              setIsTestingSensor(false);
            }, 2000); // Simulate 2 second test duration
          }
        });
      } else {
        // Simulate test when MQTT is not connected (using dummy sensor test)
        setTimeout(() => {
          const testResults = generateDummySensorTestResults(nodeId);
          // Override message to indicate it's a simulated test
          testResults.message = 'Sensor timeout detected.';
          testResults.status = testResults.status === 'success' ? 'warning' : testResults.status;
          setSensorTestResults(testResults);
          storeTestResults(nodeId, testResults);
          setIsTestingSensor(false);
        }, 2000);
      }
    } catch (error) {
      console.error('Error testing sensor:', error);
      const errorResults = {
        nodeId: nodeId,
        status: 'error',
        message: `Error testing sensor: ${error.message}`,
        timestamp: new Date().toISOString(),
        sensors: []
      };
      setSensorTestResults(errorResults);
      storeTestResults(nodeId, errorResults);
      setIsTestingSensor(false);
    }
  };

  // Helper function to normalize date to midnight
  const normalizeDate = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // Helper function to compare dates (date only, no time)
  const isSameDate = (date1, date2) => {
    if (!date1 || !date2) return false;
    const d1 = normalizeDate(date1);
    const d2 = normalizeDate(date2);
    return d1.getTime() === d2.getTime();
  };

  // State for calendar water quality data
  const [calendarQualityData, setCalendarQualityData] = useState({});

  // Fetch calendar data from backend
  useEffect(() => {
    const fetchCalendarData = async () => {
      const firstDay = new Date(currentYear, currentMonth, 1);
      const lastDay = new Date(currentYear, currentMonth + 1, 0);
      const startDate = firstDay.toISOString().split('T')[0];
      const endDate = lastDay.toISOString().split('T')[0];

      try {
        const summaries = await api.getDailySummaries({ startDate, endDate });
        const dataMap = {};
        
        summaries.forEach(summary => {
          const dateKey = summary.date;
          dataMap[dateKey] = {
            wqi: Math.round(summary.avg_wqi),
            quality: getWQIClass(summary.avg_wqi).quality,
            qualityData: getWQIClass(summary.avg_wqi),
          };
        });
        
        setCalendarQualityData(dataMap);
      } catch (error) {
        console.warn('⚠️ Could not fetch calendar data from API:', error);
        // Fallback to empty map, will use deterministic generation
        setCalendarQualityData({});
      }
    };

    fetchCalendarData();
  }, [currentMonth, currentYear]);

  // Generate calendar days for the selected month
  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    const days = [];
    
    // Add previous month's trailing days (grayed out)
    const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const day = prevMonthLastDay - i;
      const date = normalizeDate(new Date(currentYear, currentMonth - 1, day));
      days.push({
        label: String(day),
        date,
        isCurrentMonth: false,
        isToday: false,
        quality: null,
        wqi: null,
        qualityData: null,
      });
    }
    
    // Add current month's days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = normalizeDate(new Date(currentYear, currentMonth, day));
      const dateKey = date.toISOString().split('T')[0];
      const isToday = isSameDate(date, today);
      const isFuture = date > today;
      
      // Only show data for dates that are today or in the past
      // Only use data from API - no fallback data generation
      let qualityData = null;
      if (!isFuture) {
        // Only get data from API - if no data, qualityData remains null
        qualityData = calendarQualityData[dateKey] || null;
      }
      
      days.push({
        label: String(day),
        date,
        isCurrentMonth: true,
        isToday,
        isFuture,
        quality: qualityData?.quality || null,
        wqi: qualityData?.wqi || null,
        qualityData: qualityData,
      });
    }
    
    // Add next month's leading days to fill the grid (grayed out)
    const totalCells = 42; // 6 rows × 7 days
    const remainingCells = totalCells - days.length;
    for (let day = 1; day <= remainingCells; day++) {
      const date = normalizeDate(new Date(currentYear, currentMonth + 1, day));
      days.push({
        label: String(day),
        date,
        isCurrentMonth: false,
        isToday: false,
        quality: null,
        wqi: null,
        qualityData: null,
      });
    }
    
    return days;
  }, [currentMonth, currentYear, today, calendarQualityData]);

  // Navigate months
  const handlePrevMonth = () => {
    setSelectedDate(null); // Clear selection when navigating
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    setSelectedDate(null); // Clear selection when navigating
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  // Get month name
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  
  const currentMonthName = monthNames[currentMonth];

  // Today chart data - updated from MQTT live stream (30-minute intervals, 24 hours)
  // Generate 24-hour labels: 00:00, 00:30, 01:00... 23:30 (48 data points)
  const todayHours = useMemo(() => {
    const hours = [];
    for (let hour = 0; hour < 24; hour++) {
      hours.push(`${hour.toString().padStart(2, '0')}:00`);
      hours.push(`${hour.toString().padStart(2, '0')}:30`);
    }
    return hours;
  }, []);

  // Helper function to calculate average for a 30-minute mark from 10 minutes before
  const calculateAverageForTimeSlot = useCallback((readings, targetHour, targetMinute) => {
    // Get readings from 10 minutes before the target time to the target time
    // Example: For 11:30, get readings from 11:20 to 11:30 (inclusive)
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMinute, 0, 0);
    
    const startDate = new Date(targetDate);
    startDate.setMinutes(startDate.getMinutes() - 10); // 10 minutes before
    
    // Filter readings within the 10-minute window (e.g., 11:20 to 11:30)
    const relevantReadings = readings.filter(reading => {
      const readingDate = new Date(reading.timestamp);
      // Check if reading is within the time window (same day)
      return readingDate >= startDate && readingDate <= targetDate;
    });

    if (relevantReadings.length === 0) {
      return null;
    }

    // Calculate averages from valid readings
    const validTemps = relevantReadings
      .map(r => r.temperature)
      .filter(v => v !== null && v !== undefined && !isNaN(v));
    const avgTemperature = validTemps.length > 0 
      ? validTemps.reduce((sum, val) => sum + val, 0) / validTemps.length 
      : null;
    
    const validTurbs = relevantReadings
      .map(r => r.turbidity)
      .filter(v => v !== null && v !== undefined && !isNaN(v));
    const avgTurbidity = validTurbs.length > 0 
      ? validTurbs.reduce((sum, val) => sum + val, 0) / validTurbs.length 
      : null;
    
    const validPHs = relevantReadings
      .map(r => r.pH)
      .filter(v => v !== null && v !== undefined && !isNaN(v));
    const avgPH = validPHs.length > 0 
      ? validPHs.reduce((sum, val) => sum + val, 0) / validPHs.length 
      : null;

    return {
      temperature: avgTemperature,
      turbidity: avgTurbidity,
      pH: avgPH,
    };
  }, []);

  // Calculate chart data by averaging readings for each 30-minute mark
  const todayData = useMemo(() => {
    const temperatureData = [];
    const turbidityData = [];
    const pHData = [];

    // For each 30-minute mark (00:00, 00:30, 01:00, ... 23:30)
    for (let hour = 0; hour < 24; hour++) {
      for (let minute of [0, 30]) {
        const averages = calculateAverageForTimeSlot(todayChartData, hour, minute);
        temperatureData.push(averages?.temperature ?? null);
        turbidityData.push(averages?.turbidity ?? null);
        pHData.push(averages?.pH ?? null);
      }
    }

    return {
    labels: todayHours,
    datasets: [
      {
        label: "Temperature",
          data: temperatureData,
        borderColor: "#1B9C85",
        backgroundColor: "rgba(27, 156, 133, 0.3)",
        fill: true,
        tension: 0.4,
        borderWidth: 2,
      },
      {
        label: "Turbidity",
          data: turbidityData,
        borderColor: "#D45B5B",
        backgroundColor: "rgba(212, 91, 91, 0.3)",
        fill: true,
        tension: 0.4,
        borderWidth: 2,
      },
      {
        label: "Water pH",
          data: pHData,
        borderColor: "#F0A500",
        backgroundColor: "rgba(240, 165, 0, 0.3)",
        fill: true,
        tension: 0.4,
        borderWidth: 2,
      },
    ],
    };
  }, [todayChartData, todayHours, calculateAverageForTimeSlot]);

  // Auto-scroll chart to current hour
  useEffect(() => {
    const scrollToCurrentHour = () => {
      if (!chartScrollRef.current) return;
      
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      
      // Calculate index: each hour has 2 data points (00 and 30)
      // Current index = (hour * 2) + (minute >= 30 ? 1 : 0)
      const currentIndex = currentHour * 2 + (currentMinute >= 30 ? 1 : 0);
      
      // Calculate scroll position
      // Each data point is approximately 2000px / 48 = ~41.67px wide
      const chartWidth = 2000; // min-width from CSS
      const dataPointWidth = chartWidth / 48;
      const scrollPosition = currentIndex * dataPointWidth;
      
      // Scroll to current position with some offset to center it better
      const containerWidth = chartScrollRef.current.clientWidth;
      const centeredScroll = Math.max(0, scrollPosition - (containerWidth / 2) + (dataPointWidth / 2));
      
      chartScrollRef.current.scrollTo({
        left: centeredScroll,
        behavior: 'smooth'
      });
    };

    // Scroll on mount and when chart data updates
    scrollToCurrentHour();
    
    // Also scroll every 30 minutes to keep it updated
    const scrollInterval = setInterval(scrollToCurrentHour, 30 * 60 * 1000);
    
    return () => clearInterval(scrollInterval);
  }, [todayChartData]);

  // Generate date labels based on selected period and dates
  const generateDateLabels = (startDate, endDate, period) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const labels = [];
    const current = new Date(start);
    
    if (period === "week") {
      // Generate daily labels for week
      while (current <= end) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        labels.push(`${monthNames[current.getMonth()]} ${current.getDate()}`);
        current.setDate(current.getDate() + 1);
      }
    } else {
      // Generate weekly labels for month (one per week)
      let weekStart = new Date(start);
      while (weekStart <= end) {
        let weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        if (weekEnd > end) {
          weekEnd = new Date(end);
        }
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        labels.push(`${monthNames[weekStart.getMonth()]} ${weekStart.getDate()} - ${monthNames[weekEnd.getMonth()]} ${weekEnd.getDate()}`);
        weekStart.setDate(weekStart.getDate() + 7);
      }
    }
    return labels;
  };

  // State for report data from API
  const [reportData, setReportData] = useState(null);

  // Fetch report data from backend API
  useEffect(() => {
    const fetchReportData = async () => {
      setIsLoadingReport(true);
      try {
        if (reportPeriod === "week") {
          // Fetch daily summaries for the week
          const summaries = await api.getDailySummaries({
            startDate: reportStartDate,
            endDate: reportEndDate,
          });
          setReportData(summaries);
        } else {
          // Fetch daily summaries for the month
          const summaries = await api.getDailySummaries({
            startDate: reportStartDate,
            endDate: reportEndDate,
          });
          setReportData(summaries);
        }
        setLastUpdated(new Date());
      } catch (error) {
        console.warn('⚠️ Could not fetch report data from API, using fallback:', error);
        setReportData(null);
        if (isOnline) {
          showToast('Failed to load report data', 'warning', 3000);
        }
      } finally {
        setIsLoadingReport(false);
      }
    };

    fetchReportData();
  }, [reportStartDate, reportEndDate, reportPeriod, isOnline]);

  // Generate data for selected date range with aggregation type
  const generateDataForRange = useCallback((count, aggregation, apiData = null, metric = null) => {
    const currentMetric = metric || selectedWeeklyMetric;
    
    // If we have API data, use it
    if (apiData && apiData.length > 0) {
      const metricKey = currentMetric === 'ph' ? 'avg_ph' :
                       currentMetric === 'temperature' ? 'avg_temperature' :
                       currentMetric === 'turbidity' ? 'avg_turbidity' :
                       currentMetric === 'dissolvedOxygen' ? 'avg_dissolved_oxygen' :
                       'avg_nh3';
      
      if (aggregation === "lowest") {
        const minKey = currentMetric === 'ph' ? 'min_ph' :
                      currentMetric === 'temperature' ? 'min_temperature' :
                      currentMetric === 'turbidity' ? 'min_turbidity' :
                      currentMetric === 'dissolvedOxygen' ? 'min_dissolved_oxygen' :
                      'min_nh3';
        // Return data aligned with labels (keep null values for missing dates)
        return apiData.map(item => {
          const value = item[minKey];
          // Use min value if available, fallback to avg, otherwise null
          return value !== null && value !== undefined ? value : (item[metricKey] || null);
        });
      } else if (aggregation === "highest") {
        const maxKey = currentMetric === 'ph' ? 'max_ph' :
                      currentMetric === 'temperature' ? 'max_temperature' :
                      currentMetric === 'turbidity' ? 'max_turbidity' :
                      currentMetric === 'dissolvedOxygen' ? 'max_dissolved_oxygen' :
                      'max_nh3';
        // Return data aligned with labels (keep null values for missing dates)
        return apiData.map(item => {
          const value = item[maxKey];
          // Use max value if available, fallback to avg, otherwise null
          return value !== null && value !== undefined ? value : (item[metricKey] || null);
        });
      } else {
        // average
        return apiData.map(item => item[metricKey] || null);
      }
    }

    // No API data - return array of nulls matching the count
    return Array(count).fill(null);
  }, [selectedWeeklyMetric]);

  // Chart metadata (colors, labels, units) - no dummy data
  const weeklyDataByMetric = {
    temperature: {
        label: "Temperature",
        borderColor: "#8DDAD5",
        backgroundColor: "rgba(141, 218, 213, 0.1)",
      unit: "°C"
    },
    turbidity: {
      label: "Turbidity",
      borderColor: "#D45B5B",
      backgroundColor: "rgba(212, 91, 91, 0.1)",
      unit: "NTU"
    },
    ph: {
      label: "pH Level",
      borderColor: "#F0A500",
      backgroundColor: "rgba(240, 165, 0, 0.1)",
      unit: ""
    },
    dissolvedOxygen: {
      label: "Dissolved Oxygen",
      borderColor: "#1B9C85",
      backgroundColor: "rgba(27, 156, 133, 0.1)",
      unit: "mg/L"
    },
    nh3: {
      label: "NH₃",
      borderColor: "#877EDD",
      backgroundColor: "rgba(135, 126, 221, 0.1)",
      unit: "mg/L"
    }
  };

  // Calculate date range and labels
  const reportLabels = useMemo(() => {
    return generateDateLabels(reportStartDate, reportEndDate, reportPeriod);
  }, [reportStartDate, reportEndDate, reportPeriod]);

  // Format date range for display
  const formatDateRange = (start, end, period) => {
    if (period === "month") {
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      return `${monthNames[selectedMonth]} ${selectedYear}`;
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const startStr = `${monthNames[startDate.getMonth()]} ${startDate.getDate()}`;
    const endStr = `${monthNames[endDate.getMonth()]} ${endDate.getDate()}, ${endDate.getFullYear()}`;
    return `${startStr} – ${endStr}`;
  };
  
  // Update dates when month/year changes
  useEffect(() => {
    if (reportPeriod === "month") {
      const firstDay = new Date(selectedYear, selectedMonth, 1);
      const lastDay = new Date(selectedYear, selectedMonth + 1, 0);
      setReportStartDate(firstDay.toISOString().split('T')[0]);
      setReportEndDate(lastDay.toISOString().split('T')[0]);
    }
  }, [selectedMonth, selectedYear, reportPeriod]);
  
  // Function to get the week range (Sunday to Saturday) for a given date
  const getWeekRange = (date) => {
    const d = new Date(date);
    // Set to midnight to avoid timezone issues
    d.setHours(0, 0, 0, 0);
    
    const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // Calculate days to subtract to get to Sunday
    const daysToSubtract = dayOfWeek; // 0 for Sunday, 1 for Monday, etc.
    
    // Create Sunday date
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - daysToSubtract);
    
    // Create Saturday date (6 days after Sunday)
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    
    // Format as YYYY-MM-DD
    const formatDate = (dateObj) => {
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    return {
      start: formatDate(sunday),
      end: formatDate(saturday)
    };
  };
  
  // Function to handle date selection in calendar
  const handleDateSelect = (date) => {
    const weekRange = getWeekRange(date);
    setReportStartDate(weekRange.start);
    setReportEndDate(weekRange.end);
    // Update calendar to show the month of the selected week
    const selectedDate = new Date(weekRange.start);
    setCalendarMonth(selectedDate.getMonth());
    setCalendarYear(selectedDate.getFullYear());
    setIsCalendarOpen(false);
  };
  
  // Sync calendar month/year with selected dates when they change externally
  useEffect(() => {
    if (reportPeriod === "week" && reportStartDate) {
      const startDate = new Date(reportStartDate);
      // Only update if the calendar is showing a different month
      if (startDate.getMonth() !== calendarMonth || startDate.getFullYear() !== calendarYear) {
        setCalendarMonth(startDate.getMonth());
        setCalendarYear(startDate.getFullYear());
      }
    }
  }, [reportStartDate, reportPeriod]);
  
  // Generate calendar days for the current month
  const getCalendarDays = () => {
    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const lastDay = new Date(calendarYear, calendarMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday
    
    const days = [];
    
    // Add days from previous month
    const prevMonth = new Date(calendarYear, calendarMonth, 0);
    const daysInPrevMonth = prevMonth.getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: new Date(calendarYear, calendarMonth - 1, daysInPrevMonth - i),
        isCurrentMonth: false
      });
    }
    
    // Add days from current month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        date: new Date(calendarYear, calendarMonth, i),
        isCurrentMonth: true
      });
    }
    
    // Add days from next month to fill the grid
    const remainingDays = 42 - days.length; // 6 rows * 7 days
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        date: new Date(calendarYear, calendarMonth + 1, i),
        isCurrentMonth: false
      });
    }
    
    return days;
  };
  
  // Helper to format date as YYYY-MM-DD (handles timezone issues)
  const formatDateString = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  // Check if a date is in the selected week range
  const isDateInSelectedWeek = (date) => {
    const dateStr = formatDateString(date);
    return dateStr >= reportStartDate && dateStr <= reportEndDate;
  };
  
  // Check if a date is the start of the selected week
  const isWeekStart = (date) => {
    return formatDateString(date) === reportStartDate;
  };
  
  // Check if a date is the end of the selected week
  const isWeekEnd = (date) => {
    return formatDateString(date) === reportEndDate;
  };
  
  // Close calendar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isCalendarOpen && !event.target.closest('[data-calendar-container]')) {
        setIsCalendarOpen(false);
      }
    };
    
    if (isCalendarOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isCalendarOpen]);

  const weeklyData = useMemo(() => {
    const metricData = weeklyDataByMetric[selectedWeeklyMetric];
    const dataCount = reportLabels.length;
    // Generate data based on selected range and aggregation type (only from API data)
    const generatedData = generateDataForRange(dataCount, aggregationType, reportData, selectedWeeklyMetric);
    
    // Ensure data length matches labels length (pad with null if needed)
    const paddedData = [...generatedData];
    while (paddedData.length < dataCount) {
      paddedData.push(null);
    }
    // Trim if too long
    const finalData = paddedData.slice(0, dataCount);
    
    // Format label with aggregation type
    const aggregationLabel = aggregationType.charAt(0).toUpperCase() + aggregationType.slice(1);
    const label = `${aggregationLabel} ${metricData.label}`;
    
    return {
      labels: reportLabels,
      datasets: [
        {
          label: label,
          data: finalData,
          borderColor: metricData.borderColor,
          backgroundColor: metricData.backgroundColor,
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 4,
          pointBackgroundColor: metricData.borderColor,
          pointBorderColor: metricData.borderColor,
        pointHoverRadius: 6,
      },
    ],
    };
  }, [selectedWeeklyMetric, reportLabels, aggregationType, reportData, generateDataForRange]);

  // Chart options
  const todayChartOptions = useMemo(() => {
    // Generate hour labels for x-axis (show every 2 hours to reduce clutter)
    const hourLabels = [];
    for (let hour = 0; hour < 24; hour++) {
      hourLabels.push(`${hour.toString().padStart(2, '0')}:00`);
      hourLabels.push(`${hour.toString().padStart(2, '0')}:30`);
    }

    return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        mode: "index",
        intersect: false,
        backgroundColor: theme === 'dark' ? "rgba(22, 21, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
        titleColor: theme === 'dark' ? "#fff" : "#1d1d1f",
        bodyColor: theme === 'dark' ? "#fff" : "#1d1d1f",
        borderColor: theme === 'dark' ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: theme === 'dark' ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.65)",
          font: {
            size: 10,
          },
          maxRotation: 45,
          minRotation: 45,
          // Show every 2nd hour label to reduce clutter (00:00, 02:00, 04:00...)
          callback: function(value, index) {
            // Show label every 4 ticks (every 2 hours: 00:00, 02:00, 04:00, etc.)
            if (index % 4 === 0) {
              return hourLabels[index] || '';
            }
            return '';
          },
        },
        border: {
          display: false,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: theme === 'dark' ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)",
        },
        ticks: {
          color: theme === 'dark' ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.65)",
          font: {
            size: 11,
          },
        },
        border: {
          display: false,
        },
      },
    },
    interaction: {
      mode: "nearest",
      axis: "x",
      intersect: false,
    },
    };
  }, [theme]);

  // Calculate dynamic Y-axis range based on data
  const getYAxisRange = (data) => {
    if (!data || !data.datasets || data.datasets.length === 0 || !data.datasets[0].data || data.datasets[0].data.length === 0) {
      return { min: 0, max: 50 };
    }
    
    const values = data.datasets[0].data.filter(v => v !== null && v !== undefined && !isNaN(v));
    if (values.length === 0) {
      return { min: 0, max: 50 };
    }
    
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue;
    
    // Add 10% padding on each side
    const padding = Math.max(range * 0.1, 1);
    const min = Math.max(0, Math.floor(minValue - padding));
    const max = Math.ceil(maxValue + padding);
    
    return { min, max };
  };

  const weeklyChartOptions = useMemo(() => {
    const yRange = getYAxisRange(weeklyData);
    
    return {
    responsive: true,
    maintainAspectRatio: false,
      layout: {
        padding: {
          bottom: 20,
          top: 5,
          left: 5,
          right: 5,
        },
      },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
          backgroundColor: theme === 'dark' ? "rgba(22, 21, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
          titleColor: theme === 'dark' ? "#fff" : "#1d1d1f",
          bodyColor: theme === 'dark' ? "#fff" : "#1d1d1f",
          borderColor: theme === 'dark' ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
            color: theme === 'dark' ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.65)",
          font: {
              size: 10,
          },
            padding: 4,
            maxRotation: 45,
            minRotation: 0,
        },
        border: {
          display: false,
        },
      },
      y: {
          beginAtZero: false,
          min: yRange.min,
          max: yRange.max,
        grid: {
            color: theme === 'dark' ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)",
        },
        ticks: {
            color: theme === 'dark' ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.65)",
          font: {
            size: 11,
          },
        },
        border: {
          display: false,
        },
      },
    },
    };
  }, [theme, weeklyData]);

  const defaultProps = {
    center: { lat: 8.462591, lng: 124.707831 },
    zoom: 16,
  };

  const [zoomLevel, setZoomLevel] = useState(defaultProps.zoom);

  // ✅ Highlight area creation (5-meter radius)
  const handleApiLoaded = ({ map, maps }) => {
    new maps.Circle({
      strokeColor: "#4285F4",
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: "#4285F4",
      fillOpacity: 0.25,
      map,
      center: defaultProps.center,
      radius: 500, // meters
    });
  };

  // Get WQI class for current metrics (use rounded value for classification)
  const roundedWQI = currentMetrics.wqi !== null && currentMetrics.wqi !== undefined 
    ? Math.round(currentMetrics.wqi) 
    : null;
  const currentWQIClass = roundedWQI !== null ? getWQIClass(roundedWQI) : { class: 'N/A', label: 'No Data', quality: 'muted' };

  return (
    <ErrorBoundary>
    <div className="App">
        <OfflineBanner isOnline={isOnline} />
      <Navigation />
        <ConnectionStatus 
          isConnected={isConnected} 
          isConnecting={isConnecting}
          error={error} 
          onReconnect={reconnect}
          brokerUrl={process.env.REACT_APP_MQTT_URL || 'ws://localhost:9001'}
        />
        <ToastContainer toasts={toasts} onClose={removeToast} />
        
      <main className="dashboard">
        <div className="layout-grid">
          <section className="card today-card">
            <header className="section-header">
              <div>
                <h2>Today</h2>
              </div>
              <div className="legend">
                <span className="dot temperature">Temperature</span>
                <span className="dot turbidity">Turbidity</span>
                <span className="dot ph">Water pH</span>
              </div>
            </header>
            <div className="area-chart-wrapper" ref={chartScrollRef}>
              <div className="area-chart-scrollable">
                {todayData && todayData.datasets && todayData.datasets[0]?.data?.length > 0 ? (
                <Line data={todayData} options={todayChartOptions} />
                ) : (
                  <ChartSkeleton />
                )}
              </div>
            </div>
          </section>

          <section className="card alerts-card">
            <header className="section-header">
              <div>
              <h2>Alerts</h2>
                {lastUpdated && <LastUpdated timestamp={lastUpdated} />}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="badge">{alerts.length}</span>
                <RefreshButton 
                  onRefresh={handleRefresh} 
                  isRefreshing={isRefreshing}
                  ariaLabel="Refresh alerts"
                />
                </div>
            </header>
            <div className="alerts-list" role="list" aria-label="Alerts list">
              {isLoadingAlerts ? (
                <>
                  <AlertSkeleton />
                  <AlertSkeleton />
                  <AlertSkeleton />
                </>
              ) : recentAlerts.length === 0 ? (
                <EmptyState 
                  icon="🔔"
                  title="No Alerts"
                  message="All systems are operating normally"
                />
              ) : (
                recentAlerts.map((alert) => (
                  <article 
                    key={alert.id} 
                    className={`alert ${alert.severity}`}
                    role="listitem"
                    aria-label={`Alert: ${alert.title}`}
                  >
                  <p className="alert-title">{alert.title}</p>
                  <p className="alert-detail">{alert.detail}</p>
                  <p className="alert-date">{formatDateShort(alert.createdAt)}</p>
                </article>
                ))
              )}
            </div>
            {alerts.length > 0 && !isLoadingAlerts && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button
                className="ghost-btn see-more-btn"
                  style={{ flex: 1 }}
                onClick={() => setIsAlertsModalOpen(true)}
                  aria-label="View all alerts"
              >
                See more
              </button>
                <button
                  className="ghost-btn"
                  onClick={() => handleExportAlerts('json')}
                  aria-label="Export alerts as JSON"
                  title="Export as JSON"
                >
                  📥 JSON
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => handleExportAlerts('csv')}
                  aria-label="Export alerts as CSV"
                  title="Export as CSV"
                >
                  📥 CSV
                </button>
              </div>
            )}
          </section>

          <section className="card weekly-card">
            <div className="section-header" style={{ flexShrink: 0, flexWrap: "wrap", gap: "12px" }}>
              <div>
                <p className="eyebrow">Report</p>
                <h2>{formatDateRange(reportStartDate, reportEndDate)}</h2>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <select
                  className="metric-select"
                  value={reportPeriod}
                  onChange={(e) => {
                    const newPeriod = e.target.value;
                    setReportPeriod(newPeriod);
                    // Auto-adjust dates based on period
                    if (newPeriod === "week") {
                      // Week starts on Sunday
                      const today = new Date();
                      const dayOfWeek = today.getDay(); // 0 = Sunday
                      const diff = today.getDate() - dayOfWeek; // Go back to Sunday
                      const sunday = new Date(today);
                      sunday.setDate(diff);
                      const saturday = new Date(sunday);
                      saturday.setDate(saturday.getDate() + 6);
                      setReportStartDate(sunday.toISOString().split('T')[0]);
                      setReportEndDate(saturday.toISOString().split('T')[0]);
                    } else {
                      // Month: use selected month/year
                      const firstDay = new Date(selectedYear, selectedMonth, 1);
                      const lastDay = new Date(selectedYear, selectedMonth + 1, 0);
                      setReportStartDate(firstDay.toISOString().split('T')[0]);
                      setReportEndDate(lastDay.toISOString().split('T')[0]);
                    }
                  }}
                  style={{ minWidth: "100px" }}
                >
                  <option value="week">By Week</option>
                  <option value="month">By Month</option>
                </select>
                {reportPeriod === "week" ? (
                  <div style={{ position: "relative" }} data-calendar-container>
                    <button
                      className="ghost-btn"
                      onClick={(e) => {
                        if (!isCalendarOpen) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setCalendarPosition({
                            top: rect.bottom + window.scrollY + 8,
                            left: rect.left + window.scrollX
                          });
                        }
                        setIsCalendarOpen(!isCalendarOpen);
                      }}
                      style={{ 
                        minWidth: "200px", 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "space-between",
                        gap: "8px"
                      }}
                    >
                      <span>
                        {new Date(reportStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(reportEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span>📅</span>
                    </button>
                    {isCalendarOpen && (
                      <div
                        data-calendar-container
                        style={{
                          position: "fixed",
                          top: `${calendarPosition.top}px`,
                          left: `${calendarPosition.left}px`,
                          backgroundColor: "var(--panel)",
                          border: "1px solid var(--border)",
                          borderRadius: "12px",
                          padding: "16px",
                          zIndex: 2000,
                          minWidth: "300px",
                          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
                          color: "var(--text)"
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                          <button
                            className="ghost-btn"
                            onClick={() => {
                              if (calendarMonth === 0) {
                                setCalendarMonth(11);
                                setCalendarYear(calendarYear - 1);
                              } else {
                                setCalendarMonth(calendarMonth - 1);
                              }
                            }}
                            style={{ padding: "4px 8px" }}
                          >
                            ‹
                          </button>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <select
                              className="metric-select"
                              value={calendarMonth}
                              onChange={(e) => setCalendarMonth(parseInt(e.target.value))}
                              style={{ minWidth: "100px", padding: "4px 8px" }}
                            >
                              <option value="0">January</option>
                              <option value="1">February</option>
                              <option value="2">March</option>
                              <option value="3">April</option>
                              <option value="4">May</option>
                              <option value="5">June</option>
                              <option value="6">July</option>
                              <option value="7">August</option>
                              <option value="8">September</option>
                              <option value="9">October</option>
                              <option value="10">November</option>
                              <option value="11">December</option>
                            </select>
                            <select
                              className="metric-select"
                              value={calendarYear}
                              onChange={(e) => setCalendarYear(parseInt(e.target.value))}
                              style={{ minWidth: "80px", padding: "4px 8px" }}
                            >
                              {Array.from({ length: 10 }, (_, i) => {
                                const year = new Date().getFullYear() - 5 + i;
                                return (
                                  <option key={year} value={year}>
                                    {year}
                                  </option>
                                );
                              })}
                            </select>
            </div>
                          <button
                            className="ghost-btn"
                            onClick={() => {
                              if (calendarMonth === 11) {
                                setCalendarMonth(0);
                                setCalendarYear(calendarYear + 1);
                              } else {
                                setCalendarMonth(calendarMonth + 1);
                              }
                            }}
                            style={{ padding: "4px 8px" }}
                          >
                            ›
                          </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", marginBottom: "8px" }}>
                          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                            <div
                              key={day}
                              style={{
                                textAlign: "center",
                                padding: "8px",
                                fontSize: "0.85rem",
                                color: "var(--text-muted)",
                                fontWeight: "600"
                              }}
                            >
                              {day}
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px" }}>
                          {getCalendarDays().map((dayObj, idx) => {
                            const dateStr = formatDateString(dayObj.date);
                            const isInWeek = isDateInSelectedWeek(dayObj.date);
                            const isStart = isWeekStart(dayObj.date);
                            const isEnd = isWeekEnd(dayObj.date);
                            const todayStr = formatDateString(new Date());
                            const isToday = dateStr === todayStr;
                            
                            return (
                              <button
                                key={idx}
                                className="ghost-btn"
                                onClick={() => handleDateSelect(dayObj.date)}
                                style={{
                                  aspectRatio: "1",
                                  padding: "8px",
                                  borderRadius: "8px",
                                  backgroundColor: isStart || isEnd 
                                    ? "rgba(141, 218, 213, 0.3)" 
                                    : isInWeek 
                                    ? "rgba(141, 218, 213, 0.15)" 
                                    : "transparent",
                                  border: isToday ? "1px solid rgba(141, 218, 213, 0.5)" : "1px solid transparent",
                                  color: dayObj.isCurrentMonth ? "var(--text)" : "var(--text-muted)",
                                  opacity: dayObj.isCurrentMonth ? 1 : 0.5,
                                  cursor: "pointer",
                                  transition: "all 0.2s",
                                  fontSize: "0.9rem"
                                }}
                                onMouseEnter={(e) => {
                                  if (!isInWeek) {
                                    e.target.style.backgroundColor = "var(--panel-dark)";
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!isInWeek) {
                                    e.target.style.backgroundColor = "transparent";
                                  }
                                }}
                              >
                                {dayObj.date.getDate()}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
                          <button
                            className="ghost-btn"
                            onClick={() => {
                              const today = new Date();
                              const weekRange = getWeekRange(today);
                              setReportStartDate(weekRange.start);
                              setReportEndDate(weekRange.end);
                              setCalendarMonth(today.getMonth());
                              setCalendarYear(today.getFullYear());
                            }}
                            style={{ fontSize: "0.85rem", padding: "4px 8px" }}
                          >
                            Today
                          </button>
                          <button
                            className="ghost-btn"
                            onClick={() => setIsCalendarOpen(false)}
                            style={{ fontSize: "0.85rem", padding: "4px 8px" }}
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <select
                      className="metric-select"
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                      style={{ minWidth: "120px" }}
                    >
                      <option value="0">January</option>
                      <option value="1">February</option>
                      <option value="2">March</option>
                      <option value="3">April</option>
                      <option value="4">May</option>
                      <option value="5">June</option>
                      <option value="6">July</option>
                      <option value="7">August</option>
                      <option value="8">September</option>
                      <option value="9">October</option>
                      <option value="10">November</option>
                      <option value="11">December</option>
                    </select>
                    <select
                      className="metric-select"
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                      style={{ minWidth: "100px" }}
                    >
                      {Array.from({ length: 10 }, (_, i) => {
                        const year = currentDate.getFullYear() - 5 + i;
                        return (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        );
                      })}
                    </select>
                  </>
                )}
                <select
                  className="metric-select"
                  value={selectedWeeklyMetric}
                  onChange={(e) => setSelectedWeeklyMetric(e.target.value)}
                  style={{ minWidth: "140px" }}
                >
                  <option value="temperature">Temperature</option>
                  <option value="turbidity">Turbidity</option>
                  <option value="ph">pH Level</option>
                  <option value="dissolvedOxygen">Dissolved Oxygen</option>
                  <option value="nh3">NH₃</option>
                </select>
                <select
                  className="metric-select"
                  value={aggregationType}
                  onChange={(e) => setAggregationType(e.target.value)}
                  style={{ minWidth: "120px" }}
                >
                  <option value="lowest">Lowest</option>
                  <option value="average">Average</option>
                  <option value="highest">Highest</option>
                </select>
              </div>
            </div>
            <div className="line-chart">
              {isLoadingReport ? (
                <ChartSkeleton />
              ) : weeklyData && weeklyData.datasets && weeklyData.datasets[0]?.data?.length > 0 ? (
                <>
              <Line data={weeklyData} options={weeklyChartOptions} />
              <div className="chart-caption">
                <span>Highest</span>
                <span>Average</span>
                <span>Lowest</span>
              </div>
                </>
              ) : (
                <EmptyState 
                  icon="📊"
                  title="No Data Available"
                  message="No data available for the selected period"
                />
              )}
      </div>
          </section>

          <section className="card map-card">
            <div className="map-body">
              <div className="map-wrapper">
          <GoogleMapReact
            bootstrapURLKeys={{ key: "" }}
            defaultCenter={defaultProps.center}
            defaultZoom={defaultProps.zoom}
            yesIWantToUseGoogleMapApiInternals
            onGoogleApiLoaded={handleApiLoaded}
            onChange={({ zoom }) => setZoomLevel(zoom)}
          >
            <NodeMarker 
              lat={8.462591} 
              lng={124.707831} 
              zoom={zoomLevel} 
              nodeId={currentMetrics.nodeId || 1}
              onTestSensor={handleSensorTest}
              isTesting={isTestingSensor && (sensorTestResults?.nodeId === (currentMetrics.nodeId || 1) || !sensorTestResults)}
              testStatus={sensorTestResults?.nodeId === (currentMetrics.nodeId || 1) ? sensorTestResults?.status : null}
            />
          </GoogleMapReact>
        </div>
              <div className="map-meta">
                <div className="wqi-details-container">
                <div className="wqi-score">
                  <div className="score">
                     <span className="value">
                       {currentMetrics.wqi !== null && currentMetrics.wqi !== undefined 
                         ? Math.round(currentMetrics.wqi) 
                         : 'N/A'}
                     </span>
                     <span className="label">
                       {currentMetrics.wqi !== null && currentMetrics.wqi !== undefined 
                         ? `Class ${currentWQIClass.class} - ${currentWQIClass.label}` 
                         : 'No data available'}
                     </span>
                  </div>
                   <p className="wqi-label">Water Quality Index</p>
                   
                </div>
                <div className="metrics-grid">
                    <div className="metric-item">
                    <p className="metric-title">Temperature</p>
                      <p className="metric-value">
                        {currentMetrics.temperature !== null && currentMetrics.temperature !== undefined 
                          ? `${currentMetrics.temperature.toFixed(1)}°C` 
                          : 'N/A'}
                      </p>
                  </div>
                    <div className="metric-item">
                    <p className="metric-title">Turbidity</p>
                      <p className="metric-value">
                        {currentMetrics.turbidity !== null && currentMetrics.turbidity !== undefined 
                          ? `${currentMetrics.turbidity.toFixed(1)} NTU` 
                          : 'N/A'}
                      </p>
                  </div>
                    <div className="metric-item">
                    <p className="metric-title">pH Level</p>
                      <p className="metric-value">
                        {currentMetrics.pH !== null && currentMetrics.pH !== undefined 
                          ? currentMetrics.pH.toFixed(1) 
                          : 'N/A'}
                      </p>
                  </div>
                    <div className="metric-item">
                    <p className="metric-title">NH₃</p>
                      <p className="metric-value">
                        {currentMetrics.nh3 !== null && currentMetrics.nh3 !== undefined 
                          ? `${currentMetrics.nh3.toFixed(2)} mg/L` 
                          : 'N/A'}
                      </p>
                  </div>
                    <div className="metric-item">
                    <p className="metric-title">Dissolved Oxygen</p>
                      <p className="metric-value">
                        {currentMetrics.dissolvedOxygen !== null && currentMetrics.dissolvedOxygen !== undefined 
                          ? `${currentMetrics.dissolvedOxygen.toFixed(1)} mg/L` 
                          : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
        </div>
          </section>

          <section className="card calendar-card">
            <header className="section-header">
              <h2>{currentMonthName} {currentYear}</h2>
              <div className="controls">
                <button 
                  onClick={handlePrevMonth}
                  aria-label="Previous month"
                >
                  ◀
                </button>
                <button 
                  onClick={handleNextMonth}
                  aria-label="Next month"
                >
                  ▶
                </button>
              </div>
            </header>
            <div className="calendar-weekdays">
              <span>Sun</span>
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
      </div>
            <div className="calendar-grid">
              {calendarDays.map((day, index) => {
                let className = "day";
                
                // Check if date is in the future or has no data
                const hasData = day.wqi !== null && day.wqi !== undefined && !day.isFuture;
                
                if (!day.isCurrentMonth) {
                  className += " muted";
                } else if (day.isFuture || !hasData) {
                  // Future dates or dates without data should be grayed out
                  className += " muted";
                  if (day.isToday) {
                    className += " highlight";
                  }
                } else if (day.isToday) {
                  className += " highlight";
                  if (day.quality) {
                    className += ` ${day.quality}`;
                  }
                } else if (day.quality) {
                  // Use the quality class directly (supports excellent, good, caution, poor, very-poor, unsuitable)
                  className += ` ${day.quality}`;
                } else {
                  className += " muted";
                }
                
                const isSelected = selectedDate && isSameDate(day.date, selectedDate);
                
                if (isSelected) {
                  className += " selected";
                }
                
                return (
                  <span
                    key={`${day.date.getTime()}-${index}`}
                    className={className}
                    onClick={async () => {
                      if (day.isCurrentMonth && hasData) {
                        const date = normalizeDate(day.date);
                        setSelectedDate(date);
                        try {
                          const details = await getDetailedMetricsForDate(date);
                          if (details && details.date) {
                            setSelectedDateDetails(details);
                            setIsDateDetailsModalOpen(true);
                          }
                        } catch (error) {
                          console.error('Error fetching date details:', error);
                        }
                      }
                    }}
                    style={{
                      cursor: day.isCurrentMonth && hasData ? 'pointer' : 'default'
                    }}
                    title={
                      day.qualityData && hasData
                        ? `WQI: ${Math.round(day.wqi)} (Class ${day.qualityData.class} - ${day.qualityData.label})` 
                        : day.isCurrentMonth 
                          ? "No data available" 
                          : ""
                    }
                  >
                    {day.label}
                  </span>
                );
              })}
            </div>
            <div className="calendar-legend">
              <p>Status</p>
              <div className="legend-bar-wrapper">
                <div className="legend-bar" />
                {selectedDate && (() => {
                  const selectedDay = calendarDays.find(day => 
                    isSameDate(day.date, selectedDate)
                  );
                  if (selectedDay && selectedDay.wqi !== null) {
                    // Calculate position based on WQI value (0-300+ range)
                    // Gradient: Unsuitable (>300) left to Excellent (<50) right
                    // Map to 0-100%: >300 = 0-16.7%, 200-300 = 16.7-33.3%, 100-200 = 33.3-66.7%, 50-100 = 66.7-83.3%, <50 = 83.3-100%
                    let position;
                    const wqi = selectedDay.wqi;
                    if (wqi > 300) {
                      position = Math.min(((400 - wqi) / 100) * 16.7, 16.7); // 0-16.7% (capped)
                    } else if (wqi > 200) {
                      position = 16.7 + ((300 - wqi) / 100) * 16.6; // 16.7-33.3%
                    } else if (wqi > 100) {
                      position = 33.3 + ((200 - wqi) / 100) * 33.4; // 33.3-66.7%
                    } else if (wqi >= 50) {
                      position = 66.7 + ((100 - wqi) / 50) * 16.6; // 66.7-83.3%
                    } else {
                      position = 83.3 + ((50 - wqi) / 50) * 16.7; // 83.3-100%
                    }
                    
                    return (
                      <>
                        <div 
                          className="legend-indicator" 
                          style={{ left: `${position}%` }}
                        />
                        <div 
                          className="legend-score-below" 
                          style={{ left: `${position}%` }}
                        >
                          {Math.round(selectedDay.wqi)}
                        </div>
                      </>
                    );
                  }
                  return null;
                })()}
              </div>
              <div className="legend-labels">
                <span>Unsuitable (&gt;300)</span>
                <span>Excellent (&lt;50)</span>
              </div>
            </div>
          </section>
        </div>
      </main>

      {isAlertsModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            padding: "16px",
          }}
          onClick={() => setIsAlertsModalOpen(false)}
        >
          <div
            className="card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="alerts-modal-title"
            style={{
              width: "80%",
              maxWidth: "1200px",
              height: "80vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="section-header" style={{ marginBottom: "12px", flexShrink: 0 }}>
              <h2 id="alerts-modal-title">All Alerts ({sortedAlerts.length})</h2>
              <button 
                className="ghost-btn" 
                onClick={() => setIsAlertsModalOpen(false)}
                aria-label="Close alerts modal"
              >
                Close
              </button>
            </header>
            <div className="alerts-list" style={{ flex: 1, overflow: "auto", marginBottom: "16px" }}>
              {sortedAlerts.length === 0 && (
                <div className="alert empty">
                  <p className="alert-title">No alerts</p>
                  <p className="alert-detail">All clear.</p>
                </div>
              )}
              {paginatedAlerts.map((alert) => (
                <article key={alert.id} className={`alert ${alert.severity}`}>
                  <p className="alert-title">{alert.title}</p>
                  <p className="alert-detail">{alert.detail}</p>
                  <p className="alert-date">{formatDateShort(alert.createdAt)}</p>
                </article>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="pagination" style={{ 
                display: "flex", 
                justifyContent: "center", 
                alignItems: "center", 
                gap: "12px",
                paddingTop: "16px",
                borderTop: "1px solid var(--border)",
                flexShrink: 0
              }}>
                <button
                  className="ghost-btn"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  style={{
                    opacity: currentPage === 1 ? 0.5 : 1,
                    cursor: currentPage === 1 ? "not-allowed" : "pointer"
                  }}
                >
                  Previous
                </button>
                <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="ghost-btn"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  style={{
                    opacity: currentPage === totalPages ? 0.5 : 1,
                    cursor: currentPage === totalPages ? "not-allowed" : "pointer"
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Date Details Modal */}
      {isDateDetailsModalOpen && selectedDateDetails && selectedDateDetails.date && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            padding: "16px",
          }}
          onClick={() => setIsDateDetailsModalOpen(false)}
        >
          <div
            className="card date-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="date-details-modal-title"
            style={{
              width: "90%",
              maxWidth: "800px",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="section-header" style={{ marginBottom: "20px", flexShrink: 0 }}>
              <div>
                <p className="eyebrow">Water Quality Details</p>
                <h2 id="date-details-modal-title">
                  {selectedDateDetails.date && selectedDateDetails.date.toLocaleDateString ? 
                    selectedDateDetails.date.toLocaleDateString("en-US", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }) : 
                    new Date(selectedDateDetails.date).toLocaleDateString("en-US", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  }
                </h2>
              </div>
              <button 
                className="ghost-btn" 
                onClick={() => setIsDateDetailsModalOpen(false)}
                aria-label="Close date details modal"
              >
                ✕
              </button>
            </header>

            <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* WQI Score Section */}
              {(() => {
                if (!selectedDateDetails.qualityData || !selectedDateDetails.wqi) {
                  return <div>No data available for this date.</div>;
                }
                
                const quality = selectedDateDetails.qualityData.quality;
                const wqi = selectedDateDetails.wqi;
                let scoreColor, classDetails;
                
                if (quality === 'excellent') {
                  scoreColor = '#44d37e';
                  classDetails = {
                    description: "Water is of excellent quality, suitable for drinking, irrigation, and all aquatic life. All parameters are within optimal ranges. Safe for direct consumption without treatment.",
                    uses: "Drinking water, irrigation, aquaculture, recreational activities"
                  };
                } else if (quality === 'good') {
                  scoreColor = '#90ee90';
                  classDetails = {
                    description: "Water quality is good and generally safe for most uses. Minor deviations from optimal values may be present. Suitable for irrigation and most aquatic life. May require basic filtration for drinking.",
                    uses: "Irrigation, aquaculture, recreational activities, drinking with treatment"
                  };
                } else if (quality === 'poor') {
                  scoreColor = '#f0a500';
                  classDetails = {
                    description: "Water quality is poor with significant deviations from optimal values. Not recommended for drinking without extensive treatment. Limited use for irrigation. Some aquatic species may be affected.",
                    uses: "Limited irrigation (with caution), industrial cooling, NOT recommended for drinking or aquaculture"
                  };
                } else if (quality === 'very-poor') {
                  scoreColor = '#ff6b6b';
                  classDetails = {
                    description: "Water quality is very poor with severe contamination. High health risks if consumed. Unsuitable for most uses including irrigation and aquatic life. Requires immediate treatment and monitoring.",
                    uses: "NOT SAFE for any human or animal consumption. Limited industrial use only with treatment"
                  };
                } else {
                  scoreColor = '#d45b5b'; // unsuitable
                  classDetails = {
                    description: "Water is severely contaminated and unsuitable for any use. Extreme health hazards present. Critical water quality parameters are beyond acceptable limits. Immediate remediation required.",
                    uses: "UNSUITABLE - No safe use possible. Requires emergency remediation measures"
                  };
                }
                
                return (
                  <div style={{ 
                    padding: "32px 20px", 
                    background: "rgba(255,255,255,0.03)", 
                    borderRadius: "12px", 
                    border: "1px solid var(--border)",
                    display: "flex",
                    gap: "32px",
                    alignItems: "flex-start"
                  }}>
                    {/* Score Section */}
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      textAlign: "center",
                      flexShrink: 0,
                      minWidth: "200px"
                    }}>
                      <span style={{ 
                        fontSize: "4.5rem", 
                        fontWeight: "700", 
                        color: scoreColor,
                        lineHeight: "1",
                        marginBottom: "16px"
                      }}>
                        {wqi}
                      </span>
                      <div style={{ fontSize: "1.2rem", fontWeight: "600", color: scoreColor, marginBottom: "8px" }}>
                        Class {selectedDateDetails.qualityData.class} - {selectedDateDetails.qualityData.label}
                      </div>
                      <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
                        Water Quality Index
                      </div>
                    </div>
                    
                    {/* Class Details Section */}
                    <div style={{
                      flex: 1,
                      padding: "16px",
                      background: `rgba(${quality === 'excellent' ? '68, 211, 126' : quality === 'good' ? '144, 238, 144' : quality === 'poor' ? '240, 165, 0' : quality === 'very-poor' ? '255, 107, 107' : '212, 91, 91'}, 0.15)`,
                      borderRadius: "10px",
                      border: `1px solid rgba(${quality === 'excellent' ? '68, 211, 126' : quality === 'good' ? '144, 238, 144' : quality === 'poor' ? '240, 165, 0' : quality === 'very-poor' ? '255, 107, 107' : '212, 91, 91'}, 0.4)`,
                      borderLeft: `4px solid ${scoreColor}`
                    }}>
                      <div style={{ marginBottom: "12px" }}>
                        <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "500" }}>
                          WQI Range: {
                            quality === 'excellent' ? '< 50' :
                            quality === 'good' ? '50 - 100' :
                            quality === 'poor' ? '100 - 200' :
                            quality === 'very-poor' ? '200 - 300' :
                            '> 300'
                          }
                        </div>
                      </div>
                      <div style={{ fontSize: "0.95rem", color: "var(--text-muted)", lineHeight: "1.6", marginBottom: "12px" }}>
                        {classDetails.description}
                      </div>
                      <div style={{ 
                        paddingTop: "12px", 
                        borderTop: `1px solid rgba(${quality === 'excellent' ? '68, 211, 126' : quality === 'good' ? '144, 238, 144' : quality === 'poor' ? '240, 165, 0' : quality === 'very-poor' ? '255, 107, 107' : '212, 91, 91'}, 0.2)` 
                      }}>
                        <div style={{ fontSize: "0.85rem", color: scoreColor, fontWeight: "500" }}>
                          Use: {classDetails.uses}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Metrics Grid */}
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: "600", marginBottom: "16px", color: "var(--text)" }}>
                  Water Quality Parameters
                </h3>
                <div className="metrics-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                  <div style={{ padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                    <p className="metric-title">Temperature</p>
                    <p className="metric-value">
                      {selectedDateDetails.temperature !== null && selectedDateDetails.temperature !== undefined 
                        ? `${selectedDateDetails.temperature}°C` 
                        : 'N/A'}
                    </p>
                  </div>
                  <div style={{ padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                    <p className="metric-title">Turbidity</p>
                    <p className="metric-value">
                      {selectedDateDetails.turbidity !== null && selectedDateDetails.turbidity !== undefined 
                        ? `${selectedDateDetails.turbidity} NTU` 
                        : 'N/A'}
                    </p>
                  </div>
                  <div style={{ padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                    <p className="metric-title">pH Level</p>
                    <p className="metric-value">
                      {selectedDateDetails.pH !== null && selectedDateDetails.pH !== undefined 
                        ? selectedDateDetails.pH 
                        : 'N/A'}
                    </p>
                  </div>
                  <div style={{ padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                    <p className="metric-title">Dissolved Oxygen</p>
                    <p className="metric-value">
                      {selectedDateDetails.dissolvedOxygen !== null && selectedDateDetails.dissolvedOxygen !== undefined 
                        ? `${selectedDateDetails.dissolvedOxygen} mg/L` 
                        : 'N/A'}
                    </p>
                  </div>
                  <div style={{ padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                    <p className="metric-title">NH₃ (Ammonia)</p>
                    <p className="metric-value">
                      {selectedDateDetails.nh3 !== null && selectedDateDetails.nh3 !== undefined 
                        ? `${selectedDateDetails.nh3} mg/L` 
                        : 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sensor Test Results Modal */}
      {isSensorTestModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            padding: "16px",
          }}
          onClick={() => setIsSensorTestModalOpen(false)}
        >
          <div
            className="card sensor-test-modal"
            style={{
              width: "90%",
              maxWidth: "700px",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              backgroundColor: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="section-header" style={{ padding: "24px 24px 16px", borderBottom: "1px solid var(--border)" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: "700" }}>
                  Sensor Test Results
                </h2>
                <p style={{ margin: "4px 0 0", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                  Node {sensorTestResults?.nodeId || currentMetrics.nodeId || 1}
                </p>
              </div>
              <button
                className="ghost-btn"
                onClick={() => setIsSensorTestModalOpen(false)}
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.2rem",
                  padding: 0,
                }}
              >
                ×
              </button>
            </header>
            <div style={{ padding: "24px", overflowY: "auto", flex: 1 }}>
              {isTestingSensor ? (
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <div style={{ fontSize: "3rem", marginBottom: "16px" }}>⚙️</div>
                  <p style={{ fontSize: "1.1rem", color: "var(--text-muted)" }}>
                    Testing sensors...
                  </p>
                  <div style={{ 
                    width: "40px", 
                    height: "40px", 
                    border: "4px solid var(--border)", 
                    borderTopColor: "#1E88E5", 
                    borderRadius: "50%", 
                    animation: "spin 1s linear infinite",
                    margin: "20px auto"
                  }}></div>
                </div>
              ) : sensorTestResults ? (
                <div>
                  <div style={{ 
                    padding: "16px", 
                    background: sensorTestResults.status === 'success' 
                      ? "rgba(68, 211, 126, 0.1)" 
                      : sensorTestResults.status === 'warning'
                      ? "rgba(240, 165, 0, 0.1)"
                      : "rgba(212, 91, 91, 0.1)",
                    borderRadius: "8px", 
                    border: `1px solid ${sensorTestResults.status === 'success' 
                      ? "rgba(68, 211, 126, 0.3)" 
                      : sensorTestResults.status === 'warning'
                      ? "rgba(240, 165, 0, 0.3)"
                      : "rgba(212, 91, 91, 0.3)"}`,
                    marginBottom: "24px"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                      <span style={{ fontSize: "1.5rem" }}>
                        {sensorTestResults.status === 'success' ? '✅' : sensorTestResults.status === 'warning' ? '⚠️' : '❌'}
                      </span>
                      <p style={{ margin: 0, fontSize: "1rem", fontWeight: "600" }}>
                        {sensorTestResults.message}
                      </p>
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                      Test completed at {new Date(sensorTestResults.timestamp).toLocaleString()}
                    </p>
                  </div>
                  
                  <div style={{ marginTop: "24px" }}>
                    <h3 style={{ fontSize: "1.1rem", fontWeight: "600", marginBottom: "16px" }}>
                      Sensor Status
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {sensorTestResults.sensors.map((sensor, index) => (
                        <div
                          key={index}
                          style={{
                            padding: "16px",
                            background: "rgba(255,255,255,0.03)",
                            borderRadius: "8px",
                            border: "1px solid var(--border)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <p style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: "600" }}>
                              {sensor.name}
                            </p>
                            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>
                              Response: {sensor.responseTime}
                            </p>
                          </div>
                          <div style={{ textAlign: "right", marginLeft: "16px" }}>
                            <div style={{ 
                              display: "inline-flex", 
                              alignItems: "center", 
                              gap: "6px",
                              padding: "4px 12px",
                              borderRadius: "6px",
                              background: sensor.status === 'pass' 
                                ? "rgba(68, 211, 126, 0.15)" 
                                : "rgba(212, 91, 91, 0.15)",
                              color: sensor.status === 'pass' 
                                ? "#44d37e" 
                                : "#d45b5b",
                              fontSize: "0.85rem",
                              fontWeight: "600"
                            }}>
                              <span>{sensor.status === 'pass' ? '✓' : '✗'}</span>
                              <span>{sensor.status === 'pass' ? 'PASS' : 'FAIL'}</span>
                            </div>
                            <p style={{ 
                              margin: "4px 0 0", 
                              fontSize: "0.9rem", 
                              fontWeight: "600",
                              color: sensor.status === 'fail' ? "var(--text-muted)" : "var(--text)",
                              fontStyle: sensor.status === 'fail' ? "italic" : "normal"
                            }}>
                              {sensor.value}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Run Test Again Button */}
                  <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "1px solid var(--border)" }}>
                    <button
                      className="ghost-btn"
                      onClick={() => handleSensorTest(sensorTestResults.nodeId || currentMetrics.nodeId || 1, true)}
                      style={{
                        width: "100%",
                        padding: "12px 24px",
                        fontSize: "1rem",
                        fontWeight: "600",
                        borderRadius: "8px",
                        border: "1px solid var(--border)",
                        backgroundColor: "var(--panel-dark)",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.backgroundColor = "rgba(30, 136, 229, 0.1)";
                        e.target.style.borderColor = "#1E88E5";
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.backgroundColor = "var(--panel-dark)";
                        e.target.style.borderColor = "var(--border)";
                      }}
                    >
                      Run Test Again
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

    </div>
    </ErrorBoundary>
  );
};

export default App;
