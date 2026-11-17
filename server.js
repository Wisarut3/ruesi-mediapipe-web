const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;
const FLOAINO_TOKEN = 'SKDvIt6lta';
const MQTT_BROKER = 'mqtt://gateway.aithaigen.in.th:1883';
const MQTT_TOPIC = 'v1/devices/me/attributes';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let isMqttConnected = false;

const mqttClient = mqtt.connect(MQTT_BROKER, {
  username: FLOAINO_TOKEN,
  password: FLOAINO_TOKEN,
  clientId: FLOAINO_TOKEN,
  clean: true,
  reconnectPeriod: 3000
});

mqttClient.on('connect', () => {
  isMqttConnected = true;
  console.log('✅ Connected to Floaino MQTT Broker:', MQTT_BROKER);
  io.emit('mqtt_status', { connected: true, token: FLOAINO_TOKEN });

  mqttClient.subscribe(MQTT_TOPIC, (err) => {
    if (!err) {
      console.log('📡 Subscribed to topic:', MQTT_TOPIC);
    } else {
      console.error('❌ Subscription error:', err);
    }
  });
});

mqttClient.on('error', (err) => {
  console.error('MQTT Error:', err.message);
  io.emit('mqtt_status', { connected: false, error: err.message });
});

mqttClient.on('close', () => {
  isMqttConnected = false;
  io.emit('mqtt_status', { connected: false });
});

mqttClient.on('message', (topic, message) => {
  const raw = message.toString();
  console.log(`📥 [${topic}] ->`, raw);
  let parsed = { raw };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    parsed = { value: raw };
  }
  io.emit('floaino_data', {
    timestamp: new Date().toLocaleTimeString('th-TH'),
    topic,
    data: parsed
  });
});

io.on('connection', (socket) => {
  socket.emit('mqtt_status', { connected: isMqttConnected, token: FLOAINO_TOKEN });
  socket.on('simulate_data', (payload) => {
    io.emit('floaino_data', {
      timestamp: new Date().toLocaleTimeString('th-TH'),
      topic: 'simulation/local',
      data: payload
    });
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Ruesi Posture Coaching server running at http://localhost:${PORT}`);
});
