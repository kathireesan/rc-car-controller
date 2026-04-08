#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>

const char* ssid = "Redmi 12 5G";
const char* password = "1357924680";

ESP8266WebServer server(80);

// Motor Pins
#define ENA 5    // Left PWM
#define IN1 4
#define IN2 14

#define ENB 12   // Right PWM
#define IN3 13
#define IN4 15

// Other
#define HORN 16

// -- NEW: Ultrasonic Sensor Pins --
// Note: Ensure these don't conflict with your motor pins. 
// D4 (GPIO2) and D3 (GPIO0) for Front. RX (GPIO3) and TX (GPIO1) for Back.
#define TRIG_FRONT 2   // D4
#define ECHO_FRONT 0   // D3

#define TRIG_BACK 3    // RX
#define ECHO_BACK 1    // TX

long getDistance(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  // 30ms timeout = approx 5 meters max distance
  long duration = pulseIn(echoPin, HIGH, 30000); 
  if (duration == 0) return 999; // No echo
  return duration * 0.034 / 2; // Distance in cm
}

void setup() {
  Serial.begin(115200);

  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);

  pinMode(ENB, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);

  pinMode(HORN, OUTPUT);

  // Initialize Ultrasonic Pins
  pinMode(TRIG_FRONT, OUTPUT);
  pinMode(ECHO_FRONT, INPUT);
  
  pinMode(TRIG_BACK, OUTPUT);
  pinMode(ECHO_BACK, INPUT);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  Serial.println(WiFi.localIP());

  // Handle Drive Commands
  server.on("/drive", HTTP_GET, []() {
    // Add CORS headers so web UI can fetch without errors
    server.sendHeader("Access-Control-Allow-Origin", "*");

    int speed = server.arg("throttle").toInt();   // 0–1023
    int steer = server.arg("steer").toInt();      // -100 to 100
    String gear = server.arg("gear");

    int horn = server.arg("horn").toInt();

    // Convert steering into motor speeds
    int leftSpeed = speed;
    int rightSpeed = speed;

    if (steer > 0) {
      // Turning RIGHT
      rightSpeed = speed - (steer * 5);
    } else if (steer < 0) {
      // Turning LEFT
      leftSpeed = speed + (steer * 5); // steer is negative
    }

    // Limit PWM
    leftSpeed = constrain(leftSpeed, 0, 1023);
    rightSpeed = constrain(rightSpeed, 0, 1023);

    // -------- DIRECTION --------
    if (gear == "1" || gear == "2" || gear == "3" || gear == "4") {
      digitalWrite(IN1, HIGH);
      digitalWrite(IN2, LOW);

      digitalWrite(IN3, HIGH);
      digitalWrite(IN4, LOW);
    }
    else if (gear == "R") {
      digitalWrite(IN1, LOW);
      digitalWrite(IN2, HIGH);

      digitalWrite(IN3, LOW);
      digitalWrite(IN4, HIGH);
    }
    else {
      leftSpeed = 0;
      rightSpeed = 0;
    }

    // -------- SPEED (PWM) --------
    analogWrite(ENA, leftSpeed);
    analogWrite(ENB, rightSpeed);

    // -------- HORN --------
    digitalWrite(HORN, horn);

    // -------- DEBUG --------
    Serial.println("---- CAR DATA ----");
    Serial.println("Base Speed: " + String(speed));
    Serial.println("Steer: " + String(steer));
    Serial.println("Left: " + String(leftSpeed) + " | Right: " + String(rightSpeed));
    Serial.println("------------------");

    server.send(200, "text/plain", "OK");
  });

  // -- NEW: Provide Ultrasonic Data --
  server.on("/sensors", HTTP_GET, []() {
    server.sendHeader("Access-Control-Allow-Origin", "*"); // Important for fetch()
    
    long distFront = getDistance(TRIG_FRONT, ECHO_FRONT);
    long distBack = getDistance(TRIG_BACK, ECHO_BACK);
    
    // Create simple JSON response
    String json = "{\"front\": " + String(distFront) + ", \"back\": " + String(distBack) + "}";
    server.send(200, "application/json", json);
  });

  server.begin();
}

void loop() {
  server.handleClient();
}
