import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { calculateWQI, getQualityRatings } from '../utils/wqiCalculator';
import './ManualInput.css';

const ManualInput = ({ onSave, onClose }) => {
  const [inputs, setInputs] = useState({
    temperature: '',
    turbidity: '',
    pH: '',
    nh3: '',
    dissolvedOxygen: '',
  });

  // Time input - default to current time
  const getCurrentTime = () => {
    const now = new Date();
    return {
      hour: now.getHours(),
      minute: now.getMinutes() >= 30 ? 30 : 0, // Round to nearest 30-minute interval
    };
  };

  const [selectedTime, setSelectedTime] = useState(getCurrentTime());

  const [calculatedWQI, setCalculatedWQI] = useState(null);
  const [qualityRatings, setQualityRatings] = useState(null);
  const [errors, setErrors] = useState({});

  const handleInputChange = (param, value) => {
    const numValue = value === '' ? '' : parseFloat(value);
    setInputs(prev => ({
      ...prev,
      [param]: numValue === '' ? '' : (isNaN(numValue) ? prev[param] : numValue)
    }));
    
    // Clear error for this field
    if (errors[param]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[param];
        return newErrors;
      });
    }
  };

  const validateInputs = () => {
    const newErrors = {};
    
    if (inputs.temperature === '' || inputs.temperature === null) {
      newErrors.temperature = 'Temperature is required';
    } else if (inputs.temperature < -10 || inputs.temperature > 50) {
      newErrors.temperature = 'Temperature should be between -10 and 50°C';
    }
    
    if (inputs.turbidity === '' || inputs.turbidity === null) {
      newErrors.turbidity = 'Turbidity is required';
    } else if (inputs.turbidity < 0 || inputs.turbidity > 100) {
      newErrors.turbidity = 'Turbidity should be between 0 and 100 NTU';
    }
    
    if (inputs.pH === '' || inputs.pH === null) {
      newErrors.pH = 'pH is required';
    } else if (inputs.pH < 0 || inputs.pH > 14) {
      newErrors.pH = 'pH should be between 0 and 14';
    }
    
    if (inputs.nh3 === '' || inputs.nh3 === null) {
      newErrors.nh3 = 'NH₃ is required';
    } else if (inputs.nh3 < 0 || inputs.nh3 > 10) {
      newErrors.nh3 = 'NH₃ should be between 0 and 10 mg/L';
    }
    
    if (inputs.dissolvedOxygen === '' || inputs.dissolvedOxygen === null) {
      newErrors.dissolvedOxygen = 'Dissolved Oxygen is required';
    } else if (inputs.dissolvedOxygen < 0 || inputs.dissolvedOxygen > 20) {
      newErrors.dissolvedOxygen = 'Dissolved Oxygen should be between 0 and 20 mg/L';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCalculate = () => {
    if (!validateInputs()) {
      return;
    }

    const params = {
      temperature: parseFloat(inputs.temperature),
      turbidity: parseFloat(inputs.turbidity),
      pH: parseFloat(inputs.pH),
      nh3: parseFloat(inputs.nh3),
      dissolvedOxygen: parseFloat(inputs.dissolvedOxygen),
    };

    const wqi = calculateWQI(params);
    const ratings = getQualityRatings(params);
    
    setCalculatedWQI(wqi);
    setQualityRatings(ratings);
  };

  const handleSave = () => {
    if (!validateInputs() || calculatedWQI === null) {
      if (calculatedWQI === null) {
        handleCalculate();
      }
      return;
    }

    // Create timestamp from selected time
    const now = new Date();
    const timestamp = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      selectedTime.hour,
      selectedTime.minute,
      0
    );

    const reading = {
      temperature: parseFloat(inputs.temperature),
      turbidity: parseFloat(inputs.turbidity),
      pH: parseFloat(inputs.pH),
      nh3: parseFloat(inputs.nh3),
      dissolvedOxygen: parseFloat(inputs.dissolvedOxygen),
      wqi: calculatedWQI,
      timestamp: timestamp.toISOString(),
      inputHour: selectedTime.hour,
      inputMinute: selectedTime.minute,
    };

    if (onSave) {
      onSave(reading);
    }
    
    if (onClose) {
      onClose();
    }
  };

  const handleReset = () => {
    setInputs({
      temperature: '',
      turbidity: '',
      pH: '',
      nh3: '',
      dissolvedOxygen: '',
    });
    setCalculatedWQI(null);
    setQualityRatings(null);
    setErrors({});
    setSelectedTime(getCurrentTime());
  };

  return createPortal(
    <div className="manual-input-modal" role="dialog" aria-modal="true" aria-labelledby="manual-input-title">
      <div className="manual-input-content">
        <header className="manual-input-header">
          <h2 id="manual-input-title">Manual Sensor Input</h2>
          <button 
            className="close-btn" 
            onClick={onClose}
            aria-label="Close manual input"
          >
            ×
          </button>
        </header>

        <div className="manual-input-body">
          <div className="input-section">
            <h3>Enter Sensor Parameters</h3>
            
            {/* Time Selection */}
            <div className="time-selection-group">
              <label htmlFor="input-time">
                Time for this reading:
              </label>
              <div className="time-inputs">
                <select
                  id="input-hour"
                  value={selectedTime.hour}
                  onChange={(e) => setSelectedTime(prev => ({ ...prev, hour: parseInt(e.target.value) }))}
                  className="time-select"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>
                      {i.toString().padStart(2, '0')}
                    </option>
                  ))}
                </select>
                <span className="time-separator">:</span>
                <select
                  id="input-minute"
                  value={selectedTime.minute}
                  onChange={(e) => setSelectedTime(prev => ({ ...prev, minute: parseInt(e.target.value) }))}
                  className="time-select"
                >
                  <option value={0}>00</option>
                  <option value={30}>30</option>
                </select>
              </div>
              <p className="time-hint">
                Data will be saved at {selectedTime.hour.toString().padStart(2, '0')}:{selectedTime.minute.toString().padStart(2, '0')} on the chart
              </p>
            </div>

            <div className="input-grid">
              <div className="input-group">
                <label htmlFor="temperature">
                  Temperature (°C) <span className="weight-label">Weight: 0.15</span>
                </label>
                <input
                  id="temperature"
                  type="number"
                  step="0.1"
                  value={inputs.temperature}
                  onChange={(e) => handleInputChange('temperature', e.target.value)}
                  placeholder="e.g., 25.0"
                  className={errors.temperature ? 'error' : ''}
                />
                {errors.temperature && <span className="error-message">{errors.temperature}</span>}
              </div>

              <div className="input-group">
                <label htmlFor="turbidity">
                  Turbidity (NTU) <span className="weight-label">Weight: 0.15</span>
                </label>
                <input
                  id="turbidity"
                  type="number"
                  step="0.1"
                  value={inputs.turbidity}
                  onChange={(e) => handleInputChange('turbidity', e.target.value)}
                  placeholder="e.g., 15.0"
                  className={errors.turbidity ? 'error' : ''}
                />
                {errors.turbidity && <span className="error-message">{errors.turbidity}</span>}
              </div>

              <div className="input-group">
                <label htmlFor="ph">
                  pH Level <span className="weight-label">Weight: 0.20</span>
                </label>
                <input
                  id="ph"
                  type="number"
                  step="0.1"
                  value={inputs.pH}
                  onChange={(e) => handleInputChange('pH', e.target.value)}
                  placeholder="e.g., 7.0"
                  className={errors.pH ? 'error' : ''}
                />
                {errors.pH && <span className="error-message">{errors.pH}</span>}
              </div>

              <div className="input-group">
                <label htmlFor="nh3">
                  NH₃ (Ammonia) (mg/L) <span className="weight-label">Weight: 0.20</span>
                </label>
                <input
                  id="nh3"
                  type="number"
                  step="0.01"
                  value={inputs.nh3}
                  onChange={(e) => handleInputChange('nh3', e.target.value)}
                  placeholder="e.g., 0.5"
                  className={errors.nh3 ? 'error' : ''}
                />
                {errors.nh3 && <span className="error-message">{errors.nh3}</span>}
              </div>

              <div className="input-group">
                <label htmlFor="dissolvedOxygen">
                  Dissolved Oxygen (mg/L) <span className="weight-label">Weight: 0.30</span>
                </label>
                <input
                  id="dissolvedOxygen"
                  type="number"
                  step="0.1"
                  value={inputs.dissolvedOxygen}
                  onChange={(e) => handleInputChange('dissolvedOxygen', e.target.value)}
                  placeholder="e.g., 8.0"
                  className={errors.dissolvedOxygen ? 'error' : ''}
                />
                {errors.dissolvedOxygen && <span className="error-message">{errors.dissolvedOxygen}</span>}
              </div>
            </div>

            <div className="button-group">
              <button className="ghost-btn" onClick={handleReset}>
                Reset
              </button>
              <button className="primary-btn" onClick={handleCalculate}>
                Calculate WQI
              </button>
            </div>
          </div>

          {calculatedWQI !== null && qualityRatings && (
            <div className="result-section">
              <h3>Calculation Results</h3>
              
              <div className="wqi-result">
                <div className="wqi-display">
                  <span className="wqi-label">Calculated WQI:</span>
                  <span className="wqi-value">{calculatedWQI}</span>
                </div>
              </div>

              <div className="quality-ratings">
                <h4>Quality Ratings (Q_i)</h4>
                <div className="ratings-grid">
                  <div className="rating-item">
                    <span className="rating-label">Dissolved Oxygen:</span>
                    <span className="rating-value">{qualityRatings.dissolvedOxygen?.toFixed(1) || 'N/A'}</span>
                    <span className="rating-weight">× 0.30</span>
                    <span className="rating-contribution">
                      = {(qualityRatings.dissolvedOxygen * 0.30).toFixed(2)}
                    </span>
                  </div>
                  <div className="rating-item">
                    <span className="rating-label">pH:</span>
                    <span className="rating-value">{qualityRatings.pH?.toFixed(1) || 'N/A'}</span>
                    <span className="rating-weight">× 0.20</span>
                    <span className="rating-contribution">
                      = {(qualityRatings.pH * 0.20).toFixed(2)}
                    </span>
                  </div>
                  <div className="rating-item">
                    <span className="rating-label">NH₃:</span>
                    <span className="rating-value">{qualityRatings.nh3?.toFixed(1) || 'N/A'}</span>
                    <span className="rating-weight">× 0.20</span>
                    <span className="rating-contribution">
                      = {(qualityRatings.nh3 * 0.20).toFixed(2)}
                    </span>
                  </div>
                  <div className="rating-item">
                    <span className="rating-label">Turbidity:</span>
                    <span className="rating-value">{qualityRatings.turbidity?.toFixed(1) || 'N/A'}</span>
                    <span className="rating-weight">× 0.15</span>
                    <span className="rating-contribution">
                      = {(qualityRatings.turbidity * 0.15).toFixed(2)}
                    </span>
                  </div>
                  <div className="rating-item">
                    <span className="rating-label">Temperature:</span>
                    <span className="rating-value">{qualityRatings.temperature?.toFixed(1) || 'N/A'}</span>
                    <span className="rating-weight">× 0.15</span>
                    <span className="rating-contribution">
                      = {(qualityRatings.temperature * 0.15).toFixed(2)}
                    </span>
                  </div>
                </div>
                
                <div className="formula-display">
                  <p className="formula-text">
                    <strong>Formula:</strong> WQI = (Σ(Q_i × W_i)) / (Σ W_i)
                  </p>
                  <p className="formula-calculation">
                    WQI = (
                      {(qualityRatings.dissolvedOxygen * 0.30).toFixed(2)} + 
                      {(qualityRatings.pH * 0.20).toFixed(2)} + 
                      {(qualityRatings.nh3 * 0.20).toFixed(2)} + 
                      {(qualityRatings.turbidity * 0.15).toFixed(2)} + 
                      {(qualityRatings.temperature * 0.15).toFixed(2)}
                    ) / 1.00
                  </p>
                  <p className="formula-result">
                    WQI = {(
                      (qualityRatings.dissolvedOxygen * 0.30) +
                      (qualityRatings.pH * 0.20) +
                      (qualityRatings.nh3 * 0.20) +
                      (qualityRatings.turbidity * 0.15) +
                      (qualityRatings.temperature * 0.15)
                    ).toFixed(2)} ≈ <strong>{calculatedWQI}</strong>
                  </p>
                </div>
              </div>

              <div className="button-group">
                <button className="primary-btn" onClick={handleSave}>
                  Save Reading
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ManualInput;

