/*
 * WQMS LoRa Receiver / Packet Forwarder
 * Heltec LoRa32 V3
 *
 * Receives sensor JSON from sender -> sends ACK -> forwards to HiveMQ -> WQMS dashboard
 * Matches sender_sensor_node.ino; publishes to water-quality/{node_id} for wqms
 *
 * Latency instrumentation fields added by this forwarder:
 *   t_fwd_rx  - NTP epoch ms captured in OnRxDone() the instant the LoRa packet arrives
 *   t_fwd_pub - NTP epoch ms captured immediately before mqtt.publish()
 *   tdma_slot - TDMA slot index at the time of reception (for timing verification)
 *
 * Upstream fields preserved exactly as received (never overwritten):
 *   node_id, seq_id, t_node, all sensor values, and test_run_id (when present)
 *
 * TDMA awareness:
 *   It logs the TDMA slot of each received packet so you can verify nodes are
 *   transmitting in their correct slots. TDMA constants must match sender nodes.
 *
 * Requires: ArduinoJson, PubSubClient (Sketch -> Include Library -> Manage Libraries)
 */
#include "Arduino.h"
#include "LoRaWan_APP.h"
#include <Wire.h>
#include "HT_SSD1306Wire.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>

// -------------------- Config (EDIT THESE before upload) --------------------
#define WIFI_SSID          "GFiber_940ED_2.4"
#define WIFI_PASSWORD      "Chikoy201***"
#define MQTT_HOST          "c085e007016c498f841249078237ab48.s1.eu.hivemq.cloud"
#define MQTT_PORT          8883
#define MQTT_USER          "WaterQuality"
#define MQTT_PASS          "Test1234"
#define MQTT_TOPIC_PREFIX  "water-quality"
#define MQTT_TOPIC_STATUS  "lora/forwarder/status"
#define MQTT_TOPIC_COMMAND_NODE "water-quality/+/command"  // per-node commands: water-quality/{nodeId}/command
#define MQTT_TOPIC_COMMAND_ALL  "water-quality/command"    // broadcast commands

// -------------------- LoRa Settings (MUST MATCH SENDER) --------------------
#define RF_FREQUENCY               915000000  // Hz (Philippines)
#define TX_OUTPUT_POWER            5          // dBm

#define LORA_BANDWIDTH             0          // 0:125kHz
#define LORA_SPREADING_FACTOR      7
#define LORA_CODINGRATE            1
#define LORA_PREAMBLE_LENGTH       8
#define LORA_SYMBOL_TIMEOUT        0
#define LORA_FIX_LENGTH_PAYLOAD_ON false
#define LORA_IQ_INVERSION_ON       false
#define LORA_CRC_ON                true

// -------------------- Buffers --------------------
#define RX_BUF_SIZE  256
// Sensor JSON is 100+ bytes; shorter packets are noise or non-sensor (ignore to avoid "Bad/missing fields")
#define MIN_SENSOR_JSON_LEN  20
#define ACK_BUF_SIZE 140   // Must fit: ACK,<seq>,CMD:test:start:<iv>:<dur>:<run_id>
#define TX_MQTT_BUF  768   // Extra headroom for test_run_id, rssi, snr fields
#define CMD_BUF_SIZE 96    // Must fit: test:start:<interval_ms>:<duration_ms>:<test_run_id>
#define MAX_NODES    16    // Support multiple nodes; increase if needed
#define CMD_TX_BUF   128   // Must fit: CMD:test:start:<interval_ms>:<duration_ms>:<test_run_id>:<nodeId>

// -------------------- TDMA (must match sender nodes) --------------------
#define TDMA_NUM_SLOTS  8        // Total number of slots (max nodes)
#define TDMA_SLOT_MS    6000UL   // Width of each slot in ms

static uint8_t tdmaSlotOf(uint64_t epochMs) {
  if (epochMs == 0) return 0xFF;  // 0xFF = unknown (NTP not synced)
  return (uint8_t)((epochMs / TDMA_SLOT_MS) % TDMA_NUM_SLOTS);
}

// Pending commands per node (multi-node support)
typedef struct { char nodeId[16]; char command[CMD_BUF_SIZE]; bool inUse; } PendingCmd;
static PendingCmd pendingCommands[MAX_NODES];
static char rxBuf[RX_BUF_SIZE];
static char ackBuf[ACK_BUF_SIZE];
static char mqttPayload[TX_MQTT_BUF];
static char cmdTxBuf[CMD_TX_BUF];
static uint16_t rxSize    = 0;
static int16_t  lastRssi  = 0;
static int8_t   lastSnr   = 0;

// t_fwd_rx: NTP epoch ms captured the instant OnRxDone() fires (ground-truth LoRa arrival time)
static volatile uint64_t t_fwd_rx_captured = 0;

// -------------------- Broadcast commands (topic: water-quality/command) --------------------
static char    s_broadcastCmd[CMD_BUF_SIZE] = "";
static char    s_broadcastDelivered[MAX_NODES][16];
static uint8_t s_broadcastDeliveredCount = 0;
static volatile bool s_broadcastCmdTxOnce = false; // triggers first proactive LoRa broadcast immediately
// Retry interval for proactive broadcast: keep re-sending CMD:test:start every N ms
// until every known node has acknowledged it (via an incoming packet with test_run_id set).
// This covers the case where the one-shot broadcast lands outside the node's 400ms listen window.
#define BROADCAST_RETRY_INTERVAL_MS 1500UL
#define BROADCAST_STOP_TIMEOUT_MS   30000UL  // test:stop is never "confirmed" by nodes; stop retrying after 30s
static uint32_t s_broadcastLastRetryMs = 0;
static uint32_t s_broadcastSetMs = 0;        // when current broadcast was queued (for test:stop timeout)

// Nodes observed from incoming LoRa telemetry (used to target broadcast commands proactively)
static char    s_knownNodes[MAX_NODES][16];
static uint8_t s_knownNodeCount = 0;

static void rememberKnownNode(const char *nodeId) {
  if (!nodeId || !nodeId[0]) return;
  for (int i = 0; i < (int)s_knownNodeCount; i++) {
    if (strcmp(s_knownNodes[i], nodeId) == 0) return;
  }
  if (s_knownNodeCount >= MAX_NODES) return;
  strncpy(s_knownNodes[s_knownNodeCount], nodeId, 15);
  s_knownNodes[s_knownNodeCount][15] = '\0';
  s_knownNodeCount++;
}

static void setBroadcastCmd(const char *cmd) {
  if (!cmd || !cmd[0]) return;
  strncpy(s_broadcastCmd, cmd, CMD_BUF_SIZE - 1);
  s_broadcastCmd[CMD_BUF_SIZE - 1] = '\0';
  s_broadcastDeliveredCount = 0;
  s_broadcastSetMs = millis();
  for (int i = 0; i < MAX_NODES; i++) s_broadcastDelivered[i][0] = '\0';
  s_broadcastCmdTxOnce = true;
  s_broadcastLastRetryMs = 0;  // fire first retry immediately
  Serial.printf("[CMD] Broadcast queued: %s\n", s_broadcastCmd);
}

static bool broadcastAlreadyDelivered(const char *nodeId) {
  if (!nodeId || !nodeId[0]) return true;
  for (int i = 0; i < (int)s_broadcastDeliveredCount; i++) {
    if (strcmp(s_broadcastDelivered[i], nodeId) == 0) return true;
  }
  return false;
}

static void broadcastMarkDelivered(const char *nodeId) {
  if (!nodeId || !nodeId[0]) return;
  if (broadcastAlreadyDelivered(nodeId)) return;
  if (s_broadcastDeliveredCount >= MAX_NODES) return;
  strncpy(s_broadcastDelivered[s_broadcastDeliveredCount], nodeId, 15);
  s_broadcastDelivered[s_broadcastDeliveredCount][15] = '\0';
  s_broadcastDeliveredCount++;
}

static const char* getBroadcastCmdForNode(const char *nodeId) {
  if (!s_broadcastCmd[0]) return nullptr;
  if (broadcastAlreadyDelivered(nodeId)) return nullptr;
  return s_broadcastCmd;
}

// Returns true when all known nodes have acknowledged the broadcast command.
// Used to stop retrying once every node has confirmed receipt.
static bool broadcastFullyDelivered() {
  if (!s_broadcastCmd[0]) return true;
  if (s_knownNodeCount == 0) return false;  // no nodes seen yet, keep retrying
  for (int i = 0; i < (int)s_knownNodeCount; i++) {
    if (!broadcastAlreadyDelivered(s_knownNodes[i])) return false;
  }
  return true;
}

// Call when a node confirms it received the broadcast (it sent a packet with test_run_id set).
static void broadcastConfirmedByNode(const char *nodeId) {
  broadcastMarkDelivered(nodeId);
  if (broadcastFullyDelivered()) {
    Serial.println("[CMD] Broadcast fully confirmed by all known nodes - stopping retries");
  }
}

static bool getNextBroadcastTarget(char *nodeIdOut, size_t nodeIdLen) {
  if (!s_broadcastCmd[0]) return false;
  for (int i = 0; i < (int)s_knownNodeCount; i++) {
    const char *nid = s_knownNodes[i];
    if (nid[0] && !broadcastAlreadyDelivered(nid)) {
      strncpy(nodeIdOut, nid, nodeIdLen - 1);
      nodeIdOut[nodeIdLen - 1] = '\0';
      return true;
    }
  }
  return false;
}

// -------------------- OLED --------------------
SSD1306Wire factory_display(0x3c, 500000, SDA_OLED, SCL_OLED, GEOMETRY_128_64, RST_OLED);

static void VextON() {
  pinMode(Vext, OUTPUT);
  digitalWrite(Vext, LOW);
}
static void VextOFF() {
  pinMode(Vext, OUTPUT);
  digitalWrite(Vext, HIGH);
}

static void oledShow(const String &l1, const String &l2 = "", const String &l3 = "",
                     const String &l4 = "", const String &l5 = "") {
  factory_display.clear();
  factory_display.setFont(ArialMT_Plain_10);
  factory_display.drawString(0, 0,  l1);
  if (l2.length()) factory_display.drawString(0, 12, l2);
  if (l3.length()) factory_display.drawString(0, 24, l3);
  if (l4.length()) factory_display.drawString(0, 36, l4);
  if (l5.length()) factory_display.drawString(0, 48, l5);
  factory_display.display();
}

// -------------------- ISRG Root X1 CA (Let's Encrypt / HiveMQ Cloud) --------------------
static const char *root_ca PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
coyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";

// -------------------- MQTT (PubSubClient) --------------------
WiFiClientSecure espClient;
PubSubClient     mqtt(espClient);

// -------------------- NTP epoch ms helper --------------------
// Returns current NTP epoch time in milliseconds (seconds * 1000 + sub-second offset).
// The forwarder maintains WiFi continuously, so time() is always valid after syncTime().
static uint64_t epochMillis() {
  time_t secs = time(nullptr);
  if (secs < 1000000000L) return 0ULL;  // Not yet synced
  uint32_t ms_in_sec = millis() % 1000;
  return (uint64_t)secs * 1000ULL + ms_in_sec;
}

// -------------------- Radio events --------------------
static RadioEvents_t RadioEvents;

static volatile bool rxDoneFlag = false;
static volatile bool txDoneFlag = false;

void OnRxDone(uint8_t *payload, uint16_t size, int16_t rssi, int8_t snr) {
  // Capture t_fwd_rx immediately - this is the LoRa arrival timestamp
  t_fwd_rx_captured = epochMillis();

  lastRssi = rssi;
  lastSnr  = snr;
  rxSize   = (size >= (RX_BUF_SIZE - 1)) ? (RX_BUF_SIZE - 1) : size;
  memcpy(rxBuf, payload, rxSize);
  rxBuf[rxSize] = '\0';
  rxDoneFlag = true;
  Radio.Sleep();
}

void OnTxDone(void) {
  txDoneFlag = true;
}

static void configureRadio() {
  Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);

  RadioEvents.RxDone = OnRxDone;
  RadioEvents.TxDone = OnTxDone;
  Radio.Init(&RadioEvents);
  Radio.SetChannel(RF_FREQUENCY);

  Radio.SetTxConfig(MODEM_LORA, TX_OUTPUT_POWER, 0, LORA_BANDWIDTH,
                    LORA_SPREADING_FACTOR, LORA_CODINGRATE,
                    LORA_PREAMBLE_LENGTH, LORA_FIX_LENGTH_PAYLOAD_ON,
                    LORA_CRC_ON, 0, 0, LORA_IQ_INVERSION_ON, 3000);

  Radio.SetRxConfig(MODEM_LORA, LORA_BANDWIDTH, LORA_SPREADING_FACTOR,
                    LORA_CODINGRATE, 0, LORA_PREAMBLE_LENGTH,
                    LORA_SYMBOL_TIMEOUT, LORA_FIX_LENGTH_PAYLOAD_ON,
                    0, LORA_CRC_ON, 0, 0, LORA_IQ_INVERSION_ON, true);
}

static void startRx() {
  rxDoneFlag = false;
  Radio.Rx(0);
}

// -------------------- NTP --------------------
static void syncTime() {
  configTime(8 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("[NTP] Syncing time...");
  struct tm timeinfo;
  for (int i = 0; i < 30; i++) {
    delay(500);
    if (getLocalTime(&timeinfo)) {
      time_t now = mktime(&timeinfo);
      Serial.printf("[NTP] Time synced: %lu\n", (unsigned long)now);
      return;
    }
  }
  Serial.println("[NTP] Sync failed (continuing with setInsecure)");
}

// -------------------- WiFi --------------------
static void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  oledShow("WiFi", "Connecting...", WIFI_SSID);
  Serial.printf("[WiFi] Connecting to %s\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Connected: %s\n", WiFi.localIP().toString().c_str());
    syncTime();
  } else {
    Serial.println("[WiFi] Failed (retrying)");
    oledShow("WiFi FAIL", "Retrying...");
  }
}

// -------------------- Pending commands (multi-node) --------------------
static void queueCommand(const char *nodeId, const char *cmd, size_t cmdLen) {
  for (int i = 0; i < MAX_NODES; i++) {
    if (pendingCommands[i].inUse && strcmp(pendingCommands[i].nodeId, nodeId) == 0) {
      size_t n = (cmdLen < CMD_BUF_SIZE - 1) ? cmdLen : (CMD_BUF_SIZE - 1);
      memcpy(pendingCommands[i].command, cmd, n);
      pendingCommands[i].command[n] = '\0';
      Serial.printf("[CMD] Updated for %s: %s\n", nodeId, pendingCommands[i].command);
      return;
    }
  }
  for (int i = 0; i < MAX_NODES; i++) {
    if (!pendingCommands[i].inUse) {
      strncpy(pendingCommands[i].nodeId, nodeId, 15);
      pendingCommands[i].nodeId[15] = '\0';
      size_t n = (cmdLen < CMD_BUF_SIZE - 1) ? cmdLen : (CMD_BUF_SIZE - 1);
      memcpy(pendingCommands[i].command, cmd, n);
      pendingCommands[i].command[n] = '\0';
      pendingCommands[i].inUse = true;
      Serial.printf("[CMD] Queued for %s: %s\n", nodeId, pendingCommands[i].command);
      return;
    }
  }
  Serial.println("[CMD] Queue full, dropped");
}

static const char* getAndClearCommand(const char *nodeId) {
  for (int i = 0; i < MAX_NODES; i++) {
    if (pendingCommands[i].inUse && strcmp(pendingCommands[i].nodeId, nodeId) == 0 &&
        pendingCommands[i].command[0]) {
      static char tmp[CMD_BUF_SIZE];
      strncpy(tmp, pendingCommands[i].command, CMD_BUF_SIZE - 1);
      tmp[CMD_BUF_SIZE - 1] = '\0';
      pendingCommands[i].command[0] = '\0';
      pendingCommands[i].inUse = false;
      return tmp;
    }
  }
  return nullptr;
}

static bool hasAnyPendingCommand() {
  for (int i = 0; i < MAX_NODES; i++) {
    if (pendingCommands[i].inUse && pendingCommands[i].command[0]) return true;
  }
  return false;
}

static bool getNextPendingCommand(char *nodeIdOut, size_t nodeIdLen, char *cmdOut, size_t cmdLen) {
  for (int i = 0; i < MAX_NODES; i++) {
    if (pendingCommands[i].inUse && pendingCommands[i].command[0]) {
      strncpy(nodeIdOut, pendingCommands[i].nodeId, nodeIdLen - 1);
      nodeIdOut[nodeIdLen - 1] = '\0';
      strncpy(cmdOut, pendingCommands[i].command, cmdLen - 1);
      cmdOut[cmdLen - 1] = '\0';
      return true;
    }
  }
  return false;
}

static void clearCommandForNode(const char *nodeId) {
  for (int i = 0; i < MAX_NODES; i++) {
    if (pendingCommands[i].inUse && strcmp(pendingCommands[i].nodeId, nodeId) == 0) {
      pendingCommands[i].inUse = false;
      pendingCommands[i].command[0] = '\0';
      return;
    }
  }
}

// -------------------- MQTT callback (PubSubClient) --------------------
static void mqttCallback(char *topic, byte *payload, unsigned int length) {
  // Supported command topics:
  //   - water-quality/{nodeId}/command  (per-node)
  //   - water-quality/command          (broadcast)

  char nodeIdFromTopic[16] = "";

  if (strcmp(topic, MQTT_TOPIC_COMMAND_ALL) == 0) {
    nodeIdFromTopic[0] = '\0'; // broadcast
  } else {
    const char *prefix  = MQTT_TOPIC_PREFIX "/";
    const char *suffix  = "/command";
    size_t      preLen  = strlen(prefix);
    size_t      sufLen  = strlen(suffix);
    size_t      tlen    = strlen(topic);

    if (tlen <= preLen + sufLen) return;
    if (strncmp(topic, prefix, preLen) != 0) return;
    if (strcmp(topic + tlen - sufLen, suffix) != 0) return;

    size_t nodeIdLen = tlen - preLen - sufLen;
    if (nodeIdLen >= sizeof(nodeIdFromTopic)) return;
    memcpy(nodeIdFromTopic, topic + preLen, nodeIdLen);
    nodeIdFromTopic[nodeIdLen] = '\0';
  }

  // Copy payload into a null-terminated buffer
  static char inBuf[180];
  size_t n = length < (sizeof(inBuf) - 1) ? length : (sizeof(inBuf) - 1);
  memcpy(inBuf, payload, n);
  inBuf[n] = '\0';

  // Backend publishes JSON: { type: "test_start" | "test_stop", ... }
  StaticJsonDocument<256> cmdDoc;
  DeserializationError err = deserializeJson(cmdDoc, inBuf);

  if (!err) {
    const char *type = cmdDoc["type"] | (const char*)nullptr;
    const char *targetNode =
      (const char*)(cmdDoc["node_id"] | cmdDoc["nodeId"] | (const char*)nullptr);

    // For per-node topic, prefer topic node; for broadcast, use node_id/nodeId when present
    const char *nodeToQueue = nodeIdFromTopic[0] ? nodeIdFromTopic
                          : (targetNode && targetNode[0] ? targetNode : nullptr);

    char outCmd[CMD_BUF_SIZE];
    outCmd[0] = '\0';

    if (type && strcmp(type, "test_start") == 0) {
      const char *runId = cmdDoc["test_run_id"] | (const char*)nullptr;
      uint32_t intervalMs = cmdDoc["interval_ms"] | 0;
      uint32_t durationMs = cmdDoc["duration_ms"] | 0;
      if (runId && runId[0] && intervalMs > 0 && durationMs > 0) {
        snprintf(outCmd, sizeof(outCmd), "test:start:%lu:%lu:%s",
                 (unsigned long)intervalMs, (unsigned long)durationMs, runId);
      }
    } else if (type && strcmp(type, "test_stop") == 0) {
      const char *runId = cmdDoc["test_run_id"] | (const char*)nullptr;
      if (runId && runId[0]) {
        snprintf(outCmd, sizeof(outCmd), "test:stop:%s", runId);
      }
    }

    if (outCmd[0]) {
      if (nodeToQueue && nodeToQueue[0] && strcmp(nodeToQueue, "all") != 0) {
        queueCommand(nodeToQueue, outCmd, strlen(outCmd));
      } else {
        // Broadcast test command (no specific node) — will be embedded in ACK once per node.
        setBroadcastCmd(outCmd);
      }
      return;
    }

    // If JSON but not a recognized test command, ignore.
    Serial.printf("[CMD] Ignored JSON cmd on %s: %s\n", topic, inBuf);
    return;
  }

  // Legacy/raw string commands: queue as-is using topic node ID (if present)
  if (nodeIdFromTopic[0]) {
    queueCommand(nodeIdFromTopic, inBuf, strlen(inBuf));
  } else {
    // Accept firmware-friendly raw broadcast commands (e.g. test:start:...).
    if (strncmp(inBuf, "test:", 5) == 0 || strstr(inBuf, "diag") != nullptr || strstr(inBuf, "read") != nullptr) {
      setBroadcastCmd(inBuf);
    } else {
      Serial.printf("[CMD] DROP raw cmd on broadcast topic: %s\n", inBuf);
    }
  }
}

// Blocking reconnect
static void reconnectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("[MQTT] Attempting connection... ");
    String clientId = "wqms-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println("connected!");
      mqtt.publish(MQTT_TOPIC_STATUS, "forwarder online", true);
      mqtt.subscribe(MQTT_TOPIC_COMMAND_NODE);
      mqtt.subscribe(MQTT_TOPIC_COMMAND_ALL);
      Serial.println("[MQTT] Subscribed to command topics");
    } else {
      Serial.printf("failed rc=%d, retry in 5s\n", mqtt.state());
      delay(5000);
    }
  }
}

// -------------------- Validate required latency fields --------------------
// Returns true only if node_id, seq_id, and t_node are all present and non-empty/non-zero.
static bool validateRequiredFields(JsonDocument &doc, const char *rawJson) {
  const char *node_id = doc["node_id"] | (const char*)nullptr;
  if (!node_id || node_id[0] == '\0') {
    Serial.printf("[FWD] DROP - missing node_id in: %s\n", rawJson);
    return false;
  }

  if (!doc.containsKey("seq_id")) {
    Serial.printf("[FWD] DROP - missing seq_id | node_id=%s\n", node_id);
    return false;
  }

  if (!doc.containsKey("t_node")) {
    Serial.printf("[FWD] DROP - missing t_node | node_id=%s seq_id=%lu\n",
                  node_id, (unsigned long)(doc["seq_id"] | 0));
    return false;
  }

  return true;
}

// -------------------- Parse JSON, add forwarder timestamps, build topic + payload --------------------
// Preserves all upstream fields (node_id, seq_id, t_node, sensor values) exactly as received.
// Appends:
//   t_fwd_rx  - epoch ms at LoRa packet arrival (captured in OnRxDone)
//   t_fwd_pub - epoch ms immediately before mqtt.publish() (set by caller just before publishing)
//   timestamp - ISO 8601 wall-clock string for dashboard display
//   rssi      - LoRa RSSI (dBm) of the received packet
//   snr       - LoRa SNR (dB) of the received packet
//
// Returns true on success; writes topic, payload, nodeId (optional), and *seqOut.
// Use static doc to avoid large stack allocation (prevents stack overflow on ESP32).
static StaticJsonDocument<1024> jsonDoc;
static bool parseAndPreparePayload(const char *json, uint64_t t_fwd_rx,
                                   int16_t rssi, int8_t snr,
                                   char *topicOut, size_t topicLen,
                                   char *payloadOut, size_t payloadLen,
                                   uint32_t *seqOut,
                                   char *nodeIdOut, size_t nodeIdLen) {
  jsonDoc.clear();
  DeserializationError err = deserializeJson(jsonDoc, json);

  if (err) {
    Serial.printf("[JSON] Parse error: %s | raw=%s\n", err.c_str(), json);
    return false;
  }

  if (!validateRequiredFields(jsonDoc, json)) {
    return false;
  }

  uint32_t    seq_id  = jsonDoc["seq_id"] | 0;
  const char *node_id = jsonDoc["node_id"] | "unknown";

  if (seqOut) *seqOut = seq_id;
  if (nodeIdOut && nodeIdLen > 0) {
    strncpy(nodeIdOut, node_id, nodeIdLen - 1);
    nodeIdOut[nodeIdLen - 1] = '\0';
  }

  // Append t_fwd_rx (LoRa arrival epoch ms) - upstream fields are untouched
  jsonDoc["t_fwd_rx"] = (uint64_t)t_fwd_rx;

  // t_fwd_pub is set by the caller just before mqtt.publish(); placeholder 0 here
  jsonDoc["t_fwd_pub"] = (uint64_t)0;

  // LoRa link quality metrics from the received packet
  jsonDoc["rssi"] = rssi;
  jsonDoc["snr"]  = snr;

  // TDMA slot at time of reception (for timing verification; 255 = NTP unsynced)
  jsonDoc["tdma_slot"] = tdmaSlotOf(t_fwd_rx);

  // Build MQTT topic: water-quality/node_01
  snprintf(topicOut, topicLen, "%s/%s", MQTT_TOPIC_PREFIX, node_id);

  // ISO 8601 timestamp for dashboard display
  time_t now = time(nullptr);
  if (now > 0) {
    struct tm *t = gmtime(&now);
    if (t) {
      char ts[32];
      snprintf(ts, sizeof(ts), "%04d-%02d-%02dT%02d:%02d:%02d.000Z",
               t->tm_year + 1900, t->tm_mon + 1, t->tm_mday,
               t->tm_hour, t->tm_min, t->tm_sec);
      jsonDoc["timestamp"] = ts;
    }
  }
  if (!jsonDoc["timestamp"]) {
    jsonDoc["timestamp"] = "1970-01-01T00:00:00.000Z";
  }

  size_t len = serializeJson(jsonDoc, payloadOut, payloadLen);
  return len > 0 && len < payloadLen;
}

// Overwrite t_fwd_pub in an already-serialized JSON buffer.
// Finds the placeholder "\"t_fwd_pub\":0" and replaces the 0 with the actual value.
// This avoids a full re-parse/re-serialize just to stamp the publish time.
static void stampTFwdPub(char *buf, size_t bufLen, uint64_t t_fwd_pub) {
  // Find the placeholder value written as 0
  char *p = strstr(buf, "\"t_fwd_pub\":0");
  if (!p) return;

  // Replace in-place: write the real value over the '0' and shift remaining bytes if needed
  char numStr[22];
  int  numLen = snprintf(numStr, sizeof(numStr), "%llu", (unsigned long long)t_fwd_pub);
  if (numLen <= 0) return;

  char *zeroPos = p + 12;  // points to the '0' after "\"t_fwd_pub\":"
  size_t tailLen = strlen(zeroPos + 1);  // bytes after the '0'

  // Ensure there is room (numLen - 1 extra bytes needed beyond the single '0')
  size_t currentLen = strlen(buf);
  if (currentLen + (numLen - 1) >= bufLen) return;  // no room; leave placeholder

  // Shift tail to make/shrink space
  memmove(zeroPos + numLen, zeroPos + 1, tailLen + 1);
  memcpy(zeroPos, numStr, numLen);
}

// -------------------- Send ACK to sender (with optional embedded command) --------------------
static void sendAck(uint32_t seq_id, const char *nodeId) {
  int n;
  const char *cmd = nodeId ? getAndClearCommand(nodeId) : nullptr;
  if ((!cmd || !cmd[0]) && nodeId) {
    cmd = getBroadcastCmdForNode(nodeId);
    if (cmd && cmd[0]) {
      broadcastMarkDelivered(nodeId);
    }
  }
  bool hasCmd = (cmd != nullptr && cmd[0]);
  if (hasCmd) {
    n = snprintf(ackBuf, ACK_BUF_SIZE, "ACK,%lu,CMD:%s", (unsigned long)seq_id, cmd);
  } else {
    n = snprintf(ackBuf, ACK_BUF_SIZE, "ACK,%lu", (unsigned long)seq_id);
  }
  if (n <= 0 || (size_t)n >= ACK_BUF_SIZE) return;

  txDoneFlag = false;
  Radio.Send((uint8_t *)ackBuf, (uint8_t)n);

  uint32_t t0 = millis();
  while (!txDoneFlag && (millis() - t0 < 2000)) {
    Radio.IrqProcess();
    delay(1);
  }

  Serial.printf("[LoRa] %s sent: %s\n", hasCmd ? "ACK+CMD" : "ACK", ackBuf);
}

// -------------------- Proactive command TX --------------------
#define CMD_TX_INTERVAL_MS 500
static uint32_t lastProactiveCmdTx = 0;

static void sendProactiveCommand(const char *nodeId, const char *cmd) {
  int n = snprintf(cmdTxBuf, CMD_TX_BUF, "CMD:%s:%s", cmd, nodeId);
  if (n <= 0 || (size_t)n >= CMD_TX_BUF) return;

  txDoneFlag = false;
  Radio.Send((uint8_t *)cmdTxBuf, (uint8_t)n);

  uint32_t t0 = millis();
  while (!txDoneFlag && (millis() - t0 < 2000)) {
    Radio.IrqProcess();
    delay(1);
  }
  Serial.printf("[LoRa] Proactive CMD sent: %s\n", cmdTxBuf);
  startRx();
}

// Broadcast LoRa command (no node suffix). Intended for CMD:test:* so all nodes can enter TEST mode quickly.
static void sendProactiveBroadcastCmd(const char *cmd) {
  int n = snprintf(cmdTxBuf, CMD_TX_BUF, "CMD:%s", cmd);
  if (n <= 0 || (size_t)n >= CMD_TX_BUF) return;

  txDoneFlag = false;
  Radio.Send((uint8_t *)cmdTxBuf, (uint8_t)n);

  uint32_t t0 = millis();
  while (!txDoneFlag && (millis() - t0 < 2000)) {
    Radio.IrqProcess();
    delay(1);
  }
  Serial.printf("[LoRa] Proactive CMD(bcast) sent: %s\n", cmdTxBuf);
  startRx();
}

// -------------------- OLED hold + idle --------------------
static const uint32_t OLED_HOLD_MS = 2500;
static uint32_t lastOledUpdate = 0;

static void oledHoldUpdate(const String &a, const String &b, const String &c,
                           const String &d, const String &e) {
  lastOledUpdate = millis();
  oledShow(a, b, c, d, e);
}

static void refreshIdleScreen() {
  if (millis() - lastOledUpdate < OLED_HOLD_MS) return;

  if (WiFi.status() == WL_CONNECTED && mqtt.connected()) {
    oledShow("RX Ready", WiFi.localIP().toString(), "HiveMQ: OK",
             String("Topic: ") + MQTT_TOPIC_PREFIX + "/{node_id}", "Waiting for LoRa...");
  } else if (WiFi.status() == WL_CONNECTED) {
    oledShow("RX Ready", WiFi.localIP().toString(), "MQTT: connecting...");
  } else {
    oledShow("RX Ready", "WiFi: connecting...");
  }
}

// -------------------- Arduino --------------------
void setup() {
  Serial.begin(115200);

  VextON();
  delay(100);
  factory_display.init();
  factory_display.clear();
  factory_display.display();

  oledHoldUpdate("BOOT", "WiFi...", "", "", "");
  ensureWiFi();

  oledHoldUpdate("BOOT", "MQTT...", "", "", "");
  espClient.setCACert(root_ca);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(768);
  reconnectMQTT();

  oledHoldUpdate("BOOT", "Init LoRa...", "", "", "");
  configureRadio();
  startRx();

  lastOledUpdate = millis();
}

void loop() {
  Radio.IrqProcess();

  ensureWiFi();
  if (!mqtt.connected()) reconnectMQTT();
  mqtt.loop();

  // Proactive broadcast for CMD:test:* — fires immediately on receipt, then retries every
  // BROADCAST_RETRY_INTERVAL_MS until every known node has confirmed (sent a packet with
  // test_run_id set), or for test:stop until BROADCAST_STOP_TIMEOUT_MS (nodes don't confirm stop).
  if (s_broadcastCmd[0] && strncmp(s_broadcastCmd, "test:", 5) == 0) {
    uint32_t nowMs = millis();
    bool isStop = (strncmp(s_broadcastCmd, "test:stop:", 10) == 0);
    if (isStop && (nowMs - s_broadcastSetMs >= BROADCAST_STOP_TIMEOUT_MS)) {
      s_broadcastCmd[0] = '\0';
      Serial.println("[CMD] test:stop broadcast timeout - cleared");
    } else if (!broadcastFullyDelivered()) {
      if (s_broadcastCmdTxOnce || (nowMs - s_broadcastLastRetryMs >= BROADCAST_RETRY_INTERVAL_MS)) {
        sendProactiveBroadcastCmd(s_broadcastCmd);
        s_broadcastCmdTxOnce = false;
        s_broadcastLastRetryMs = nowMs;
      }
    }
  }

  if (rxDoneFlag) {
    rxDoneFlag = false;

    // Snapshot t_fwd_rx before any processing (set atomically in OnRxDone)
    uint64_t t_fwd_rx = t_fwd_rx_captured;

    uint8_t rxSlot = tdmaSlotOf(t_fwd_rx);
    if (rxSlot == 0xFF) {
      Serial.printf("[LoRa] RX: %s | RSSI=%d SNR=%d len=%u t_fwd_rx=%llu slot=?\n",
                    rxBuf, lastRssi, lastSnr, rxSize, (unsigned long long)t_fwd_rx);
    } else {
      Serial.printf("[LoRa] RX: %s | RSSI=%d SNR=%d len=%u t_fwd_rx=%llu slot=%u\n",
                    rxBuf, lastRssi, lastSnr, rxSize, (unsigned long long)t_fwd_rx, rxSlot);
    }

    // Ignore very short packets (noise, fragments, or non-sensor); sensor JSON is 100+ bytes
    if (rxSize < MIN_SENSOR_JSON_LEN) {
      Serial.printf("[FWD] Ignore - packet too short (len=%u), likely noise or non-sensor\n", rxSize);
      oledHoldUpdate("LoRa RX (ignored)", String("RSSI: ") + lastRssi,
                     String("len: ") + rxSize, "Too short (noise?)", "");
      startRx();
    } else {
    uint32_t seq_id = 0;
    char     topic[64];
    char     nodeId[16] = "";

    // 1) Parse, validate required fields, and prepare MQTT payload
    bool parsed = parseAndPreparePayload(rxBuf, t_fwd_rx,
                                         lastRssi, lastSnr,
                                         topic, sizeof(topic),
                                         mqttPayload, sizeof(mqttPayload),
                                         &seq_id, nodeId, sizeof(nodeId));

    // Remember this node so we can target broadcast commands proactively.
    if (nodeId[0]) rememberKnownNode(nodeId);

    // If this packet carries a test_run_id, the node has confirmed it received the broadcast.
    // Stop retrying the broadcast for this node.
    if (nodeId[0] && jsonDoc.containsKey("test_run_id")) {
      broadcastConfirmedByNode(nodeId);
    }

    // 2) Send ACK immediately (sender is waiting); include queued command if any
    sendAck(seq_id, nodeId);

    // 3) Forward to HiveMQ
    if (parsed) {
      if (mqtt.connected()) {
        // Stamp t_fwd_pub immediately before publish - this is the forwarder queuing/processing end
        uint64_t t_fwd_pub = epochMillis();
        stampTFwdPub(mqttPayload, sizeof(mqttPayload), t_fwd_pub);

        bool ok = mqtt.publish(topic, mqttPayload, false);

        if (ok) {
          Serial.printf("[MQTT] Published -> %s | node_id=%s seq_id=%lu "
                        "t_fwd_rx=%llu t_fwd_pub=%llu\n",
                        topic, nodeId, (unsigned long)seq_id,
                        (unsigned long long)t_fwd_rx, (unsigned long long)t_fwd_pub);
          oledHoldUpdate("Forwarded OK", String("Topic: ") + topic,
                         String("RSSI: ") + lastRssi + " SNR:" + lastSnr,
                         "Sent to HiveMQ", "");
        } else {
          Serial.printf("[MQTT] FAIL publish -> %s | node_id=%s seq_id=%lu "
                        "t_fwd_rx=%llu t_fwd_pub=%llu\n",
                        topic, nodeId, (unsigned long)seq_id,
                        (unsigned long long)t_fwd_rx, (unsigned long long)t_fwd_pub);
          oledHoldUpdate("MQTT FAIL", String("node_id: ") + nodeId,
                         String("seq_id: ") + seq_id, "Packet dropped", "");
        }
      } else {
        Serial.printf("[MQTT] Not connected - dropped | node_id=%s seq_id=%lu\n",
                      nodeId, (unsigned long)seq_id);
        oledHoldUpdate("LoRa RX (no MQTT)", String("node_id: ") + nodeId,
                       String("seq_id: ") + seq_id, "MQTT disconnected", "");
      }
    } else {
      Serial.printf("[FWD] Invalid packet len=%u raw=%s\n", rxSize, rxBuf);
      oledHoldUpdate("LoRa RX (invalid)", String("RSSI: ") + lastRssi,
                     String("len: ") + rxSize, "Bad/missing fields", "");
    }

    startRx();
    }  // end else (packet long enough to parse)
  }

  // Proactive command TX: send queued commands quickly (without waiting for next ACK cycle)
  if (millis() - lastProactiveCmdTx >= CMD_TX_INTERVAL_MS) {
    char nodeId[16], cmd[CMD_BUF_SIZE];
    bool sent = false;

    if (hasAnyPendingCommand() && getNextPendingCommand(nodeId, sizeof(nodeId), cmd, sizeof(cmd))) {
      sendProactiveCommand(nodeId, cmd);
      sent = true;
    } else if (getNextBroadcastTarget(nodeId, sizeof(nodeId))) {
      sendProactiveCommand(nodeId, s_broadcastCmd);
      sent = true;
    }

    if (sent) lastProactiveCmdTx = millis();
  }

  refreshIdleScreen();
}
