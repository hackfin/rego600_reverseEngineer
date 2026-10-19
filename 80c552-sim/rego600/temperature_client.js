// Temperature client, being fed a temperature array of up to 8 temperatures
// every second.
//
// (c) 2026, section5.se

let windowSeconds = 7200;
let latestTimestamp = 0;
let hoverSample = null;

let NUM_CHANNELS = 8;

const COLOR_VTICKS = "rgba(255, 255, 255, 0.20)";
const COLOR_HTICKS = "rgba(255, 255, 255, 0.8)";

const COLORS = [
    "#c62828", "#1565c0", "#2e7d32",
    "#8e24aa", "#ef00fa", "#aaaafc",
    "#c5e22b", "#1eb156",
];

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        hour12: false
    });
}

function initGraph(samples) {
	const canvas = document.getElementById("graph");

	// ------------------------------------------------------------
	// Mouse hover inspection
	// ------------------------------------------------------------

	canvas.addEventListener("mousemove", event => {
		if (!samples.length) return;

		const tooltip = document.getElementById("tooltip");
		const container = document.getElementById("graphContainer");

		const rect = canvas.getBoundingClientRect();
		const width = rect.width;
		const marginLeft = 55;
		const marginRight = 15;
		const plotW = width - marginLeft - marginRight;

		const mouseX = event.clientX - rect.left;
		if (mouseX < marginLeft || mouseX > width - marginRight) {
			tooltip.style.display = "none";
			hoverSample = null;
			drawGraph(samples);
			return;
		}

		const endTime = latestTimestamp || Date.now();
		const startTime = endTime - windowSeconds * 1000;

		const targetTime = startTime +
			((mouseX - marginLeft) / plotW) * windowSeconds * 1000;

		let nearest = null;
		let distance = Infinity;

		for (const s of samples) {
			if (s.time < startTime || s.time > endTime) continue;

			const d = Math.abs(s.time - targetTime);
			if (d < distance) {
				distance = d;
				nearest = s;
			}
		}

		hoverSample = nearest;
		drawGraph(samples);

		if (!nearest) {
			tooltip.style.display = "none";
			return;
		}

		tooltip.innerHTML = "";

		const dateLine = document.createElement("div");
		dateLine.textContent = formatDate(nearest.time);
		tooltip.appendChild(dateLine);

		for (let i = 0; i < NUM_CHANNELS; i++) {
			const line = document.createElement("div");
			line.style.color = COLORS[i];
			line.textContent = `T[${i}]: ${nearest.T[i].toFixed(3)} °C`;
			tooltip.appendChild(line);
		}

		const stateLine = document.createElement("div");
		stateLine.textContent =
			"Heating: " +
			(nearest.enabled === null ? "unknown" :
			 nearest.enabled ? "ON" : "OFF");
		tooltip.appendChild(stateLine);

		tooltip.style.display = "block";

		const containerRect = container.getBoundingClientRect();
		const tooltipX = event.clientX - containerRect.left + 12;
		const tooltipY = event.clientY - containerRect.top + 12;

		tooltip.style.left = tooltipX + "px";

//		tooltip.style.left = Math.min(
//			tooltipX, container.clientWidth - tooltip.offsetWidth - 5
//		) + "px";

		tooltip.style.top = Math.min(
			tooltipY, container.clientHeight - tooltip.offsetHeight - 5
		) + "px";
	});

	canvas.addEventListener("mouseleave", () => {
		hoverSample = null;
		tooltip.style.display = "none";
		drawGraph(samples);
	});


}

function drawGraph(samples) {
	const canvas = document.getElementById("graph");
	const ctx = canvas.getContext("2d");

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;

    if (
        canvas.width !== Math.round(width * dpr) ||
        canvas.height !== Math.round(height * dpr)
    ) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const margin = { left: 55, right: 15, top: 15, bottom: 38 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    if (plotW <= 0 || plotH <= 0) return;

    const endTime = latestTimestamp || Date.now();
    const startTime = endTime - windowSeconds * 1000;

    const visible = samples.filter(s =>
        s.time >= startTime && s.time <= endTime
    );

    // Automatic vertical scale, rounded to sensible bounds.
    let minT = 0;
    let maxT = 50;

    if (visible.length) {
        const values = visible.flatMap(s => s.T);
        const dataMin = Math.min(...values);
        const dataMax = Math.max(...values);
        const padding = Math.max(2, (dataMax - dataMin) * 0.12);

        minT = Math.floor((dataMin - padding) / 5) * 5;
        maxT = Math.ceil((dataMax + padding) / 5) * 5;

        if (minT === maxT) maxT = minT + 5;
    }

    const x = t => margin.left +
        ((t - startTime) / (windowSeconds * 1000)) * plotW;

    const y = t => margin.top +
        ((maxT - t) / (maxT - minT)) * plotH;

    // Heating-state backgrounds, segmented by sample state.
    // Unknown state is shown as neutral gray.
    const all = samples.filter(s => s.time <= endTime);
    let previousState = null;
    let segmentStart = startTime;

    for (const s of all) {
        if (s.time < startTime) {
            previousState = s.enabled;
            continue;
        }

        if (previousState === null) {
            previousState = s.enabled;
            segmentStart = s.time;
            continue;
        }

        if (s.enabled !== previousState) {
            fillState(segmentStart, s.time, previousState);
            segmentStart = s.time;
            previousState = s.enabled;
        }
    }

    fillState(segmentStart, endTime, previousState);

    function fillState(from, to, state) {
        const left = Math.max(margin.left, x(from));
        const right = Math.min(margin.left + plotW, x(to));

        if (right <= left) return;

        ctx.fillStyle =
            state === true ? "rgba(255, 70, 70, 0.22)" :
            state === false ? "rgba(60, 145, 255, 0.22)" :
            "rgba(150, 150, 150, 0.10)";

        ctx.fillRect(left, margin.top, right - left, plotH);
    }

    // Horizontal grid and temperature labels.
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const tickStep = Math.max(1, Math.ceil((maxT - minT) / 8 / 5) * 5);

    for (
        let t = Math.ceil(minT / tickStep) * tickStep;
        t <= maxT;
        t += tickStep
    ) {
        const py = y(t);

        ctx.strokeStyle = COLOR_VTICKS;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, py);
        ctx.lineTo(margin.left + plotW, py);
        ctx.stroke();

        ctx.fillStyle = "#cccccc";
        ctx.fillText(`${t}°`, margin.left - 8, py);
    }

    // Time labels along the bottom.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let i = 0; i <= 4; i++) {
        const t = startTime + windowSeconds * 1000 * i / 4;
        const px = x(t);

        ctx.strokeStyle = COLOR_HTICKS;
        ctx.beginPath();
        ctx.moveTo(px, margin.top);
        ctx.lineTo(px, margin.top + plotH);
        ctx.stroke();

        ctx.fillStyle = "#cccccc";
        ctx.fillText(
            new Date(t).toLocaleTimeString(),
            px,
            margin.top + plotH + 8
        );
    }

    // Temperature traces.
    for (let i = 0; i < NUM_CHANNELS; i++) {
        ctx.strokeStyle = COLORS[i];
        ctx.lineWidth = 2;
        ctx.beginPath();

        let started = false;

        for (const s of visible) {
            const px = x(s.time);
            const py = y(s.T[i]);

            if (!started) {
                ctx.moveTo(px, py);
                started = true;
            } else {
                ctx.lineTo(px, py);
            }
        }

        ctx.stroke();
    }

    // Plot border.
    ctx.strokeStyle = "#69737d";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);

    // Hover crosshair and sample markers.
    if (hoverSample && visible.includes(hoverSample)) {
        const px = x(hoverSample.time);

        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#20242a";
        ctx.beginPath();
        ctx.moveTo(px, margin.top);
        ctx.lineTo(px, margin.top + plotH);
        ctx.stroke();
        ctx.restore();

        for (let i = 0; i < NUM_CHANNELS; i++) {
            ctx.beginPath();
            ctx.arc(px, y(hoverSample.T[i]), 4, 0, Math.PI * 2);
            ctx.fillStyle = COLORS[i];
            ctx.fill();
            ctx.strokeStyle = "white";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }
}


class TemperatureClient {
    constructor(url, onUpdate = () => {}, map = {},
                historySeconds = 7200) {
        this.url = url;
        this.onUpdate = onUpdate;
        this.historySeconds = historySeconds;

        this.T = null;
        this.map = map;
        this.enabled = null;
        this.samples = [];
        this.lastCommand = null;
        this.socket = null;
        this.connected = false;
        this.prev_state = null;
    	this._timer = null;
    }

	update() {
		drawGraph(this.samples);
		let state = heating_state();
		if (this.prev_state != state) {
			this.enable(state);
		}
		this.prev_state = state;
	};

	setConnection(state, text, color) {
		const hmen = document.getElementById("hm_enable");
		const connEl = document.getElementById("connection");
		const dotEl = document.getElementById("connection-dot");
		hmen.disabled = !state;
		if (connEl) connEl.textContent = text;
		if (dotEl) dotEl.style.background = color;
	};


    connect() {
        this.socket = new WebSocket(this.url);

        this.socket.onopen = () => {
            this.connected = true;
			this.setConnection(true, "Connected", "#229954");

            this.onUpdate(this);
			this._timer = setInterval(() => this.update(), 1000);
			initGraph(this.samples);
		};

        this.socket.onclose = () => {
            this.connected = false;
			this.setConnection(false, "Disconnected/not up", "#cc3333");
            this.onUpdate(this);
			this._timer = null;
        };

		this.socket.onerror = () => this.setConnection(false, "WebSocket error", "#cc3333");

        this.socket.onmessage = event => {
            let msg;

            try {
                msg = JSON.parse(event.data);
            } catch (e) {
                console.error("Invalid WebSocket JSON", e);
                return;
            }


            if (msg.type === "status") {
                this.enabled = msg.enabled;
                this.onUpdate(this);
                return;
            }

            if (msg.type !== "temperatures") return;
            if (!Array.isArray(msg.T) ||
                msg.T.length !== NUM_CHANNELS ||
                !msg.T.every(Number.isFinite)) {
				console.log("Illegal number of temperatures", msg.T.length);
                return;
            }

            const time = Number.isFinite(msg.timestamp)
                ? msg.timestamp * 1000
                : Date.now();

            this.T = msg.T.slice();

            this.samples.push({
                time,
                T: this.T.slice(),
                enabled: this.enabled
            });

            this.pruneHistory(time);

            // Notify the framework that new data has arrived.
            this.onUpdate(this);

        };
    }

    pruneHistory(now) {
        const cutoff = now - this.historySeconds * 1000;

        while (
            this.samples.length > 1 &&
            this.samples[1].time < cutoff
        ) {
            this.samples.shift();
        }
    }

    enable(on) {
        if (!this.socket ||
            this.socket.readyState !== WebSocket.OPEN) {
            return false;
        }

        this.socket.send(JSON.stringify({
            type: "enable",
            on: Boolean(on)
        }));

        this.lastCommand = Boolean(on);
        return true;
    }
}
