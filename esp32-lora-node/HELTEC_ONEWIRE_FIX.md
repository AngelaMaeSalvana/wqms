# OneWire + Heltec ESP32 GPIO_IS_VALID_GPIO Fix

The OneWire library fails to compile with Heltec ESP32 Dev-Boards because `GPIO_IS_VALID_GPIO` is not declared. Apply this fix:

## Option 1: Manual one-line patch

1. Open your OneWire library file:
   - **Path:** `Documents\Arduino\libraries\OneWire\util\OneWire_direct_gpio.h`
   - Or: `C:\Users\<YourUsername>\Documents\Arduino\libraries\OneWire\util\OneWire_direct_gpio.h`

2. Find the line:
   ```cpp
   #elif defined(ARDUINO_ARCH_ESP32)
   #include "Arduino.h"
   #include "esp32-hal-gpio.h"
   ```

3. Add **before** those includes (as the first line inside the ESP32 block):
   ```cpp
   #include "driver/gpio.h"
   ```

   So it becomes:
   ```cpp
   #elif defined(ARDUINO_ARCH_ESP32)
   #include "driver/gpio.h"
   #include "Arduino.h"
   #include "esp32-hal-gpio.h"
   ```

4. Save the file and recompile.

## Option 2: Apply the patch file

A patch reference is in `esp32-lora-node\OneWire_fix\util\OneWire_direct_gpio_PATCH.txt`.

**Note:** If you update the OneWire library later, you may need to re-apply this patch.
