#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>

const char* ssid = "Redmi 12 5G";
const char* password = "1357924680";

// -------- ULTRASONIC PINS --------
// Front Ultrasonic Sensor
const int trigPinFront = 5;  // GPIO5 (D1)
const int echoPinFront = 12; // GPIO12 (D6)

// Back Ultrasonic Sensor
const int trigPinBack = 15;  // GPIO15 (D8)
const int echoPinBack = 3;   // GPIO3 (RX)

long distFront = 999;
long distBack = 999;
unsigned long lastSensorRead = 0;

ESP8266WebServer server(80);

// -------- PINS (No Enable Pins) --------
// Left Motor
const int in1 = 4;   // GPIO4
const int in2 = 14;  // GPIO14

// Right Motor
const int in3 = 13;  // GPIO13
const int in4 = 0;   // GPIO0

// Aux
const int lightPin = 16;
const int hornPin  = 2;

// -------- MOTOR HELPERS --------
void setLeftMotor(int dir) {
  // dir: 1=forward, -1=backward, 0=stop
  if (dir > 0) {
    digitalWrite(in1, HIGH);
    digitalWrite(in2, LOW);
  } else if (dir < 0) {
    digitalWrite(in1, LOW);
    digitalWrite(in2, HIGH);
  } else {
    digitalWrite(in1, LOW);
    digitalWrite(in2, LOW);
  }
}

void setRightMotor(int dir) {
  if (dir > 0) {
    digitalWrite(in3, HIGH);
    digitalWrite(in4, LOW);
  } else if (dir < 0) {
    digitalWrite(in3, LOW);
    digitalWrite(in4, HIGH);
  } else {
    digitalWrite(in3, LOW);
    digitalWrite(in4, LOW);
  }
}

void stopAll() {
  setLeftMotor(0);
  setRightMotor(0);
}

// -------- HANDLERS --------
void handleRoot() {
  server.send(200, "text/plain", "RC Car Ready");
}

void handleSensors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String json = "{\"front\": " + String(distFront) + ", \"back\": " + String(distBack) + "}";
  server.send(200, "application/json", json);
}

long readDistance(int trig, int echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
  long duration = pulseIn(echo, HIGH, 30000); // 30ms timeout ~ 5 meters
  if (duration == 0) return 999;
  return duration * 0.034 / 2;
}

void handleDrive() {
  server.sendHeader("Access-Control-Allow-Origin", "*");

  int steer    = server.hasArg("steer")    ? server.arg("steer").toInt()    : 0;
  int throttle = server.hasArg("throttle") ? server.arg("throttle").toInt() : 0;
  int brake    = server.hasArg("brake")    ? server.arg("brake").toInt()    : 0;
  int light    = server.hasArg("light")    ? server.arg("light").toInt()    : 0;
  int horn     = server.hasArg("horn")     ? server.arg("horn").toInt()     : 0;
  String gear  = server.hasArg("gear")     ? server.arg("gear")             : "1";

  Serial.println("------ RECEIVED ------");
  Serial.println("Throttle: " + String(throttle));
  Serial.println("Steer:    " + String(steer));
  Serial.println("Brake:    " + String(brake));
  Serial.println("Gear:     " + gear);
  Serial.println("----------------------");

  // ======== BRAKE ========
  if (brake == 1) {
    stopAll();
    server.send(200, "text/plain", "OK");
    return;
  }

  // ======== DIRECTION ========
  int driveDir = 0;
  if (throttle > 3) {
    driveDir = (gear == "R") ? -1 : 1;
  }

  // ======== EMERGENCY BRAKE (Hardware-level) ========
  if (driveDir == 1 && distFront < 20) {
    driveDir = 0; // Force stop if object in front
  }
  if (driveDir == -1 && distBack < 20) {
    driveDir = 0; // Force stop if object in back
  }

  // ======== STEERING + DRIVE ========
  if (driveDir != 0) {
    // Moving: steer by stopping one side
    if (steer > 10) {
      // Turn RIGHT: stop right motor
      setLeftMotor(driveDir);
      setRightMotor(0);
    } else if (steer < -10) {
      // Turn LEFT: stop left motor
      setLeftMotor(0);
      setRightMotor(driveDir);
    } else {
      // Straight
      setLeftMotor(driveDir);
      setRightMotor(driveDir);
    }
  } else if (abs(steer) > 10) {
    // Spot turn (no throttle)
    if (steer > 10) {
      // Spin RIGHT: left forward, right backward
      setLeftMotor(1);
      setRightMotor(-1);
    } else {
      // Spin LEFT: left backward, right forward
      setLeftMotor(-1);
      setRightMotor(1);
    }
  } else {
    // No throttle, no steer = stop
    stopAll();
  }

  // ======== AUX ========
  digitalWrite(lightPin, light ? HIGH : LOW);
  digitalWrite(hornPin,  horn  ? HIGH : LOW);

  server.send(200, "text/plain", "OK");
}

// -------- SETUP --------
void setup() {
  Serial.begin(115200);

  pinMode(in1, OUTPUT);
  pinMode(in2, OUTPUT);
  pinMode(in3, OUTPUT);
  pinMode(in4, OUTPUT);
  pinMode(lightPin, OUTPUT);
  pinMode(hornPin, OUTPUT);

  pinMode(trigPinFront, OUTPUT);
  pinMode(echoPinFront, INPUT);
  pinMode(trigPinBack, OUTPUT);
  pinMode(echoPinBack, INPUT);

  stopAll();
  digitalWrite(lightPin, LOW);
  digitalWrite(hornPin, LOW);

  Serial.println("\nConnecting to WiFi...");
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    attempts++;
    if (attempts > 40) {
      // After 20 seconds, restart and try again
      Serial.println("\nFailed to connect! Restarting...");
      ESP.restart();
    }
  }

  Serial.println("\nConnected!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  server.on("/", handleRoot);
  server.on("/drive", handleDrive);
  server.on("/sensors", handleSensors);
  server.begin();
  Serial.println("HTTP server started");
}

// -------- LOOP --------
void loop() {
  server.handleClient();
  
  // Read sensors non-blocking every 100ms
  if (millis() - lastSensorRead > 100) {
    distFront = readDistance(trigPinFront, echoPinFront);
    distBack = readDistance(trigPinBack, echoPinBack);
    lastSensorRead = millis();
  }
}