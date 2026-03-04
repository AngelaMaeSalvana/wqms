/**
 * Sensor Reading Library for ESP32 LoRa Water Quality Monitoring
 * 
 * This library provides functions to read and calibrate sensor values
 * for the water quality monitoring system.
 */

#ifndef SENSORS_H
#define SENSORS_H

#include "config.h"
#include <Arduino.h>

// ============================================
// Helper Functions
// ============================================

/**
 * Read analog value from a pin with averaging
 * @param pin GPIO pin number
 * @param samples Number of samples to average (default: 10)
 * @return Averaged ADC reading (0-4095)
 */
int readAnalogAverage(int pin, int samples = 10) {
  long sum = 0;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(pin);
    delay(10); // Small delay between readings
  }
  return sum / samples;
}

/**
 * Convert ADC reading to voltage
 * @param adcValue ADC reading (0-4095)
 * @return Voltage in volts
 */
float adcToVoltage(int adcValue) {
  return (adcValue * ESP32_VOLTAGE_REF) / ADC_MAX_VALUE;
}

/**
 * Linear interpolation for sensor calibration
 * @param value Input value
 * @param inMin Minimum input value
 * @param inMax Maximum input value
 * @param outMin Minimum output value
 * @param outMax Maximum output value
 * @return Calibrated output value
 */
float linearInterpolate(float value, float inMin, float inMax, float outMin, float outMax) {
  if (value <= inMin) return outMin;
  if (value >= inMax) return outMax;
  return outMin + ((value - inMin) * (outMax - outMin) / (inMax - inMin));
}

/**
 * Read battery voltage from voltage divider on ADC pin.
 * Single Li-ion: 4.2V = 100%, 3.3V = 0%.
 * Returns NAN if BATTERY_PIN is -1 or reading fails.
 */
float readBatteryVoltage() {
#if defined(BATTERY_PIN) && BATTERY_PIN >= 0
  int raw = readAnalogAverage(BATTERY_PIN);
  float adcVoltage = adcToVoltage(raw);
  float vBattery = adcVoltage * BATTERY_VOLTAGE_DIVIDER;
  if (DEBUG_MODE) {
    Serial.print("🔋 Battery: ");
    Serial.print(vBattery);
    Serial.println(" V");
  }
  return vBattery;
#else
  return NAN;
#endif
}

// ============================================
// Sensor Reading Functions
// ============================================

/**
 * Read temperature sensor
 * @return Temperature in Celsius, or SENSOR_ERROR_VALUE on error
 */
float readTemperature() {
  int rawValue = readAnalogAverage(TEMP_SENSOR_PIN);
  float voltage = adcToVoltage(rawValue);
  
  // Convert voltage to temperature using linear interpolation
  float temperature = linearInterpolate(
    voltage,
    TEMP_MIN_VOLTAGE, TEMP_MAX_VOLTAGE,
    TEMP_MIN_VALUE, TEMP_MAX_VALUE
  );
  
  // Validate reading
  if (temperature < MIN_VALID_TEMP || temperature > MAX_VALID_TEMP) {
    if (DEBUG_MODE) {
      Serial.print("⚠️ Invalid temperature reading: ");
      Serial.println(temperature);
    }
    return SENSOR_ERROR_VALUE;
  }
  
  if (DEBUG_MODE) {
    Serial.print("🌡️ Temperature: ");
    Serial.print(temperature);
    Serial.println(" °C");
  }
  
  return temperature;
}

/**
 * Read turbidity sensor
 * @return Turbidity in NTU, or SENSOR_ERROR_VALUE on error
 */
float readTurbidity() {
  int rawValue = readAnalogAverage(TURBIDITY_SENSOR_PIN);
  float voltage = adcToVoltage(rawValue);
  
  // Convert voltage to turbidity (NTU)
  float turbidity = linearInterpolate(
    voltage,
    TURBIDITY_MIN_VOLTAGE, TURBIDITY_MAX_VOLTAGE,
    TURBIDITY_MIN_VALUE, TURBIDITY_MAX_VALUE
  );
  
  // Turbidity should be non-negative
  if (turbidity < 0) {
    turbidity = 0;
  }
  
  if (DEBUG_MODE) {
    Serial.print("💧 Turbidity: ");
    Serial.print(turbidity);
    Serial.println(" NTU");
  }
  
  return turbidity;
}

/**
 * Read pH sensor
 * @return pH value (0-14), or SENSOR_ERROR_VALUE on error
 */
float readPH() {
  int rawValue = readAnalogAverage(PH_SENSOR_PIN);
  float voltage = adcToVoltage(rawValue);
  
  // Convert voltage to pH using linear interpolation
  // pH sensors typically have a linear relationship in a specific range
  float pH = linearInterpolate(
    voltage,
    PH_MIN_VOLTAGE, PH_MAX_VOLTAGE,
    PH_MIN_VALUE, PH_MAX_VALUE
  );
  
  // Validate reading
  if (pH < MIN_VALID_PH || pH > MAX_VALID_PH) {
    if (DEBUG_MODE) {
      Serial.print("⚠️ Invalid pH reading: ");
      Serial.println(pH);
    }
    return SENSOR_ERROR_VALUE;
  }
  
  if (DEBUG_MODE) {
    Serial.print("🧪 pH: ");
    Serial.println(pH);
  }
  
  return pH;
}

/**
 * Read NH3 (Ammonia) sensor
 * @return NH3 concentration in mg/L, or SENSOR_ERROR_VALUE on error
 */
float readNH3() {
  int rawValue = readAnalogAverage(NH3_SENSOR_PIN);
  float voltage = adcToVoltage(rawValue);
  
  // Convert voltage to NH3 concentration (mg/L)
  float nh3 = linearInterpolate(
    voltage,
    NH3_MIN_VOLTAGE, NH3_MAX_VOLTAGE,
    NH3_MIN_VALUE, NH3_MAX_VALUE
  );
  
  // NH3 should be non-negative
  if (nh3 < 0) {
    nh3 = 0;
  }
  
  if (DEBUG_MODE) {
    Serial.print("☁️ NH3: ");
    Serial.print(nh3);
    Serial.println(" mg/L");
  }
  
  return nh3;
}

/**
 * Read Dissolved Oxygen sensor
 * @return Dissolved Oxygen in mg/L, or SENSOR_ERROR_VALUE on error
 */
float readDissolvedOxygen() {
  int rawValue = readAnalogAverage(DO_SENSOR_PIN);
  float voltage = adcToVoltage(rawValue);
  
  // Convert voltage to Dissolved Oxygen (mg/L)
  float dissolvedOxygen = linearInterpolate(
    voltage,
    DO_MIN_VOLTAGE, DO_MAX_VOLTAGE,
    DO_MIN_VALUE, DO_MAX_VALUE
  );
  
  // DO should be non-negative
  if (dissolvedOxygen < 0) {
    dissolvedOxygen = 0;
  }
  
  if (DEBUG_MODE) {
    Serial.print("💨 Dissolved Oxygen: ");
    Serial.print(dissolvedOxygen);
    Serial.println(" mg/L");
  }
  
  return dissolvedOxygen;
}

/**
 * Read all sensors and return a structure with all values
 * This function handles errors gracefully and continues reading other sensors
 * even if one fails
 */
struct SensorReadings {
  float temperature;
  float turbidity;
  float pH;
  float nh3;
  float dissolvedOxygen;
  bool hasErrors;
  
  SensorReadings() {
    temperature = SENSOR_ERROR_VALUE;
    turbidity = SENSOR_ERROR_VALUE;
    pH = SENSOR_ERROR_VALUE;
    nh3 = SENSOR_ERROR_VALUE;
    dissolvedOxygen = SENSOR_ERROR_VALUE;
    hasErrors = false;
  }
};

SensorReadings readAllSensors() {
  SensorReadings readings;
  
  if (DEBUG_MODE) {
    Serial.println("\n📊 Reading all sensors...");
  }
  
  // Read each sensor with error handling
  readings.temperature = readTemperature();
  if (readings.temperature == SENSOR_ERROR_VALUE) {
    readings.hasErrors = true;
  }
  
  readings.turbidity = readTurbidity();
  if (readings.turbidity == SENSOR_ERROR_VALUE) {
    readings.hasErrors = true;
  }
  
  readings.pH = readPH();
  if (readings.pH == SENSOR_ERROR_VALUE) {
    readings.hasErrors = true;
  }
  
  readings.nh3 = readNH3();
  if (readings.nh3 == SENSOR_ERROR_VALUE) {
    readings.hasErrors = true;
  }
  
  readings.dissolvedOxygen = readDissolvedOxygen();
  if (readings.dissolvedOxygen == SENSOR_ERROR_VALUE) {
    readings.hasErrors = true;
  }
  
  if (DEBUG_MODE) {
    Serial.println("✅ Sensor reading complete");
    if (readings.hasErrors) {
      Serial.println("⚠️ Some sensors returned errors");
    }
  }
  
  return readings;
}

#endif // SENSORS_H

