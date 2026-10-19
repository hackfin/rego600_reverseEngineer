# Simple temperature server, both web socket and http interface.
#
# (c) 2026, section5.se
#
# Uses SMHI history data and the simplified heating model to
# behave as virtual sensor model for the rego600 front end.
#
# NOTE: Prior to running the server, you might want to modify the
# STATION_ID in smhi_history.py and run it to pull the archive CSV file.
# It was found to not work for all stations.
#
# You may modify START_SIM/END_SIM below, make sure you provide enough
# data. In this implementation, the behaviour is 10x accelerated,
# see simulation_loop().
#
# In order to make the rego600 respond quickly to the heating state,
# you may want to reduce the holdoff time before pump start (setting 0x62).
# For the moment, you would have to edit builtin_data.js and look for
# occurences of 0x00, 0x62 in the configuration sector (first 0x10000).
# The following two bytes (big endian) define the timeout. A setting of
# 0x00 0x0a would hence restart after 10 RTC seconds.

import asyncio
import json
import math
import time
from datetime import datetime
# from websockets.asyncio.server import serve
from websockets import serve
from websockets.exceptions import ConnectionClosed

START_SIM = "2024-01-11 00:00:00"
END_SIM   = "2024-02-11 02:00:00"  # Make sure we got enough values

HOST = "127.0.0.1"
HTTP_PORT = 8000
WS_PORT = 8765
UPDATE_INTERVAL = 1.0

import smhi_history

from heating_reference_model import HeatingSimulation

class TemperatureSimulation:
	"""Owns the virtual temperatures and advances the simulation."""

	def __init__(self):
		self.T = [25.0, 20.0, 22.0, 35.0, 18.0, 1.0, 0.0, 20.0]
		self.enabled = False
		self.elapsed = 0.0

		df = smhi_history.parse_local_smhi_csv("data.csv")

		step_size = "1s"

		sim_ambient_temps = smhi_history.extract_and_interpolate_temp(
			df,
			START_SIM,
			END_SIM,
			time_step=step_size
		)

		sim_ts = sim_ambient_temps["Temperatur_C"]

		self.model = HeatingSimulation(
			dt = 10.0,
			flow_m3_h = 1.9,
			T_room = 14.0,
			T_ambient = sim_ts.iloc[0],
			T_supply = 18.2,
			UA_rad = 650.0,
			UA_loss = 220.0,
			thermal_inertia_house = 15_000_000,
			loop_travel_time = 300.0,
			V_circuit = 0.15,
			start = datetime.strptime(START_SIM, "%Y-%m-%d %H:%M:%S")
		)

		self.model.state = self.model.IDLE

		self.ts = sim_ts

	def enable(self, on: bool):
		"""Enable or disable the heating effect on T[1]."""
		self.enabled = bool(on)
		self.model.enable(on)

	def visit(self, dt: float):
		h = self.model
		self.elapsed += dt
		h.T_ambient = self.ts.iloc[int(self.elapsed)]
		h.visit(dt)

		self.T[0] = h.T_return_sensor # GT1
		self.T[1] = h.T_ambient # GT2
		self.T[2] = h.T_supply # GT8
		self.T[3] = h.T_return_sensor # GT9
		self.T[4] = h.T_compr # GT6
		self.T[5] = 55.0 # Fixed hot water temp
		self.T[6] = 0.0
		self.T[7] = h.T_room


simulation = TemperatureSimulation()
active_client = None


HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Virtual Temperatures</title>
<style>
body {
	font: 16px system-ui, sans-serif;
	max-width: 650px;
	margin: 2rem auto;
	padding: 0 1rem;
	background: #f5f6f8;
	color: #20242a;
}
h1 { font-size: 1.6rem; }
.temperatures {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: 12px;
}
.card {
	background: white;
	padding: 18px;
	border-radius: 10px;
	box-shadow: 0 1px 4px #0001;
}
.name { color: #5b6470; }
.value { font-size: 2rem; font-weight: 600; }
.status { margin: 1rem 0; }
.dot {
	display: inline-block;
	width: 10px;
	height: 10px;
	border-radius: 50%;
	background: #999;
	margin-right: 6px;
}
</style>
</head>
<body>
<h1>Virtual Temperatures</h1>
<p>Updates once per second from the Python simulation.</p>

<div id="connection" class="status">
	<span class="dot"></span>Connecting...
</div>

<div class="temperatures" id="temperatures"></div>

<p class="status">
	Threshold: <b>T[0] &gt; 30 °C</b><br>
	Heating effect: <b id="enabled">disabled</b>
</p>

<script>
const threshold = 30;
const socket = new WebSocket("ws://" + location.hostname + ":8765");
let lastCommand = null;

const container = document.getElementById("temperatures");

for (let i = 0; i < 5; i++) {
	const card = document.createElement("div");
	card.className = "card";
	card.innerHTML =
		'<div class="name">T[' + i + ']</div>' +
		'<div class="value" id="t' + i + '">--.- °C</div>';
	container.appendChild(card);
}

function setConnection(text, color) {
	document.getElementById("connection").innerHTML =
		'<span class="dot" style="background:' + color +
		'"></span>' + text;
}

socket.onopen = () => setConnection("Connected", "#229954");
socket.onclose = () => setConnection("Disconnected", "#cc3333");
socket.onerror = () => setConnection("WebSocket error", "#cc3333");

socket.onmessage = (event) => {
	const msg = JSON.parse(event.data);

	if (msg.type === "temperatures") {
		msg.T.forEach((value, i) => {
			document.getElementById("t" + i).textContent =
				value.toFixed(2) + " °C";
		});

		// Browser-side threshold detection.
		const shouldEnable = msg.T[0] > threshold;

		// Send only when the requested state changes.
		if (shouldEnable !== lastCommand && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({
				type: "enable",
				on: shouldEnable
			}));
			lastCommand = shouldEnable;
		}
	}

	if (msg.type === "status") {
		document.getElementById("enabled").textContent =
			msg.enabled ? "enabled" : "disabled";
	}
};
</script>
</body>
</html>
"""


async def http_handler(reader, writer):
	"""Serve the embedded HTML page using a minimal HTTP/1.1 handler."""
	try:
		request = await asyncio.wait_for(reader.readline(), timeout=5)
		if not request:
			return

		method, path, *_ = request.decode("ascii", "replace").strip().split()
		# Consume request headers.
		while True:
			line = await reader.readline()
			if line in (b"\r\n", b"\n", b""):
				break

		if method == "GET" and path.split("?")[0] in ("/", "/index.html"):
			body = HTML.encode("utf-8")
			status = "200 OK"
			content_type = "text/html; charset=utf-8"
		else:
			body = b"Not found"
			status = "404 Not Found"
			content_type = "text/plain; charset=utf-8"

		headers = (
			f"HTTP/1.1 {status}\r\n"
			f"Content-Type: {content_type}\r\n"
			f"Content-Length: {len(body)}\r\n"
			"Connection: close\r\n"
			"\r\n"
		).encode("ascii")

		writer.write(headers + body)
		await writer.drain()
	except (asyncio.TimeoutError, ConnectionError, ValueError):
		pass
	finally:
		writer.close()
		try:
			await writer.wait_closed()
		except ConnectionError:
			pass


async def websocket_handler(websocket):
	"""Accept one browser and process its JSON commands."""
	global active_client

	if active_client is not None:
		await websocket.close(1013, "Only one client is supported")
		return

	active_client = websocket
	print("Browser connected")

	try:
		await websocket.send(json.dumps({
			"type": "status",
			"enabled": simulation.enabled,
		}))

		async for raw in websocket:
			try:
				msg = json.loads(raw)
			except json.JSONDecodeError:
				continue

			if msg.get("type") == "enable" and isinstance(
				msg.get("on"), bool
			):
				simulation.enable(msg["on"])
				print(f"enable({msg['on']})")

				await websocket.send(json.dumps({
					"type": "status",
					"enabled": simulation.enabled,
				}))
	except ConnectionClosed:
		pass
	finally:
		if active_client is websocket:
			active_client = None
		print("Browser disconnected")


async def simulation_loop():
	"""Advance simulation and publish temperatures every second."""
	loop = asyncio.get_running_loop()
	last = loop.time()

	while True:
		await asyncio.sleep(UPDATE_INTERVAL)

		now = loop.time()
		dt = now - last
		last = now

		simulation.visit(dt * 10.0)

		client = active_client
		if client is not None:
			try:
				await client.send(json.dumps({
					"type": "temperatures",
					"T": simulation.T,
					"timestamp": time.time(),
				}))
				print("DEBUG SEND", simulation.T, simulation.enabled)
			except ConnectionClosed:
				pass


async def main():
	http_server = await asyncio.start_server(
		http_handler, HOST, HTTP_PORT
	)

	async with serve(websocket_handler, HOST, WS_PORT):
		print(f"Open http://{HOST}:{HTTP_PORT}/ in your browser")
		print(f"WebSocket listening on {HOST}:{WS_PORT}")
		try:
			await simulation_loop()
		finally:
			http_server.close()
			await http_server.wait_closed()


if __name__ == "__main__":
	try:
		asyncio.run(main())
	except KeyboardInterrupt:
		print("\nServer stopped")

