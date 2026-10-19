# Simplified heating model
#
# 2026, section5.se
#
# Licensing "rules": Be so kind and publish derived models as well.
#

"""Contains a rough heating model of a classical radiator system for a
house. Does not include any modifications for floor heatings or other
type of shunts
"""


from dataclasses import dataclass, field
from collections import deque
import matplotlib.pyplot as plt
import math
from datetime import datetime
import time

import random

import smhi_history

class TemperatureWalk:
	def __init__(self, temp=20.0, temp_limit=24.0, dt=1.0,
		constant=1.0, noise_avg=0.0):

		self.temp = temp
		self.temp_limit = temp_limit
		self.tendency_up = False
		self.tendency_down = False
		self.dt = dt
		self.constant = constant
		self.noise_avg = noise_avg

	def iterate(self):
		noise = random.gauss(self.noise_avg, 1.0) * self.constant * (self.dt ** 0.5)

		drift = 0.0
		if self.tendency_up and not self.tendency_down:
			drift = self.constant * self.dt
		elif self.tendency_down and not self.tendency_up:
			drift = -self.constant * self.dt

		self.temp += drift + noise

		if self.temp > self.temp_limit:
			self.temp = self.temp_limit
		elif self.temp < -self.temp_limit:
			self.temp = -self.temp_limit

		return self.temp


@dataclass
class HeatingSimulation_Unlimited:
	"Stupid model with no energy limit. Not physical. See derived class below"
	dt: float = 10.0
	flow_m3_h: float = 2.0
	T_room: float = 18.0
	V_circuit: float = 0.3

	C_w: float = 4184.0		# Specific heat capacity of water (J/kg·K)
	C_air: float = 1005.0	# Specific heat capacity of air (J/kg·K)
	rho_w: float = 1000.0	# Density of water (kg/m³)

	UA_hx: float = 2500.0	  # Overall HX heat transfer coefficient (W/K)

	T_refrigerant: float = 85.0  # Compressor max temperature

	# Time for compressor/refrigerant temperature to reach
	# its nominal condensing temperature.
	warmup_time: float = 600.0

	# Start time, by default now().
	start : float = time.time()

	# Additional startup time constant for the HX itself.
	# This is not a thermal-capacitance model; it simply ramps
	# the effective HX transfer coefficient.
	hx_startup_time: float = 60.0

	# Radiator network efficiency
	UA_rad: float = 600.0

	# House parameters
	thermal_inertia_house: float = 30_000_000
	UA_loss: float = 300.0
	T_ambient: float = 0.0

	# Initial water temperature
	T_supply: float = 8.0

	# Estimated transport delay through the longer pipes (seconds)
	loop_travel_time: float = 600.0

	# Delay line is initialized in __post_init__
	pipe_delay_line: deque = field(default_factory=deque, init=False)

	# States
	# Note: Only HEAT and !HEAT are relevant in this setup
	RESET, IDLE, HEAT, SETTLE = range(4)

	@property
	def r(self):
		return self.T_return_sensor

	@property
	def f(self):
		return self.T_supply

	def __post_init__(self):
		# Number of simulation steps represented by the pipe delay.
		delay_steps = max(1, int(self.loop_travel_time / self.dt))

		self.t0 = 0.0

		# Store the initial supply temperature
		# This is assumed as the settled temperature in the heating
		# room. Not necessarily the same as the room temperature.
		self.T_initial = self.T_supply

		# The transport delay model:
		self.pipe_delay_line = deque(
			[self.T_initial] * delay_steps,
			maxlen=delay_steps
		)

		# --- Derived system parameters ---
		self.m_circuit = self.V_circuit * self.rho_w

		# flow_m3_h -> kg/s:
		# 1 m³/h = 1000/3600 kg/s = 1/3.6 kg/s
		self.mdot_w = self.flow_m3_h / 3.6

		# --- Simulation state ---
		self.state = self.RESET

		self.Q_in = 0.0
		self.Q_out = 0.0

		self.T_return = self.T_room
		self.T_return_sensor = self.T_initial # the delayed one

		self.cur_t = 0.0
		self.T_compr_prev = self.T_initial

		# Effective compressor/refrigerant temperature
		self.T_compr = self.T_initial

		# Current water entering the HX
		self.t_inlet = self.T_initial

	def log(self, ar):
		t_comp, t_supp, t_return, t_room, t_delta, t_outdoor, q_in, q_out = ar

		t_room.append(self.T_room)
		t_comp.append(self.T_compr)
		t_supp.append(self.T_supply)
		t_return.append(self.T_return_sensor)
		t_delta.append(self.T_supply - self.T_return_sensor)
		t_outdoor.append(self.T_ambient)
		q_in.append(self.Q_in / 1000.0)
		q_out.append(self.Q_out / 1000.0)

	def enable(self, on):
		if on and self.state != self.HEAT:
			self.t0 = self.cur_t
			self.state = self.HEAT
			self.T_compr_prev = self.T_compr
		elif self.state == self.HEAT:
			self.state = self.SETTLE
		elif on == False:
			self.state = self.IDLE
		else:
			raise ValueError(f"Unhandled {on} state {self.state}")

	def handle_compressor(self, tau):
		step = self.cur_t

		if self.state == self.HEAT:
			self.T_compr = self.T_compr_prev + \
				(self.T_refrigerant - self.T_compr_prev) * \
				(1.0 - math.exp((self.t0 - step) / self.warmup_time))
				
		else:
			# Simple compressor/refrigerant cool-down when not heating.
			self.T_compr -= (
				(self.T_compr - self.T_supply)
				/ tau
			)

	def visit(self, dt = None):
		if dt is None:
			dt = self.dt
		step = self.cur_t

		# ============================================================
		# 1. Compressor / refrigerant warm-up
		# ============================================================

		self.handle_compressor(100.0)

		# ============================================================
		# 2. Heat exchanger startup
		# ============================================================
		#
		# The HX itself is not modelled as a thermal mass. Instead,
		# its effective UA approaches the nominal value exponentially.
		#
		# At t = 0:
		#
		#	  UA_eff = 0
		#
		# and eventually:
		#
		#	  UA_eff -> UA_hx
		#
		# This represents the startup behavior without introducing
		# another dynamic temperature state.
		# ============================================================

		hx_time = min(step, self.hx_startup_time * 10.0)

		if self.hx_startup_time > 0.0:
			hx_factor = 1.0 - math.exp(
				-hx_time / self.hx_startup_time
			)
		else:
			hx_factor = 1.0

		UA_eff = self.UA_hx * hx_factor


		# ============================================================
		# 3. Heat exchanger
		# ============================================================
		#
		# T_return_sensor is the water temperature arriving back at
		# the heat pump after the pipe delay.
		#
		# UA_hx is the overall refrigerant-to-water HX coefficient.
		# ============================================================

		self.Q_in = UA_eff * (
			self.T_compr - self.T_return_sensor
		)

		# ============================================================
		# 4. Radiator network
		# ============================================================

		self.Q_out = self.UA_rad * (
			self.T_supply - self.T_room
		)

		# ============================================================
		# 5. Water circuit energy balance
		# ============================================================
		#
		# The water volume stores the difference between heat entering
		# through the HX and heat leaving through the radiators.
		# ============================================================

		dT_supply = (
			(self.Q_in - self.Q_out)
			/ (self.m_circuit * self.C_w)
		) * dt

		self.T_supply += dT_supply

		# ============================================================
		# 6. Radiator return temperature
		# ============================================================
		#
		# Q = m_dot * cp * delta_T
		# ============================================================

		if self.mdot_w > 0.0:
			self.T_return = (
				self.T_supply
				- self.Q_out / (self.mdot_w * self.C_w)
			)
		else:
			self.T_return = self.T_supply

		# ============================================================
		# 7. Pipe transport delay
		# ============================================================

		# inlet jumps directly to the return temperature.
		# Nicer would be to smoothly adjust.
		# We might model the pipe delay using a simple IIR filter
		# instead.
		self.t_inlet = self.T_return

		self.pipe_delay_line.append(self.t_inlet)

		self.T_return_sensor = self.pipe_delay_line[0]

		# ============================================================
		# 8. House thermal balance
		# ============================================================

		Q_losses = self.UA_loss * (
			self.T_room - t_aeff
		)

		Q_net_house = self.Q_out - Q_losses

		dT_room = dt * Q_net_house / self.thermal_inertia_house

		self.T_room += dT_room

		# ============================================================
		# 9. Advance simulation time
		# ============================================================

		self.cur_t += dt

		# ============================================================
		# 10. Logging
		# ============================================================


class HeatingSimulation(HeatingSimulation_Unlimited):
	"""Heating system model with a thermal output limit."""

	Q_hp_max: float = 17_000.0	# Maximum thermal output, W

	def visit(self, dt = None):
		if dt is None:
			dt = self.dt
		step = self.cur_t

		# ============================================================
		# 1. Compressor / refrigerant warm-up
		# ============================================================

		self.handle_compressor(50.0)

		# ============================================================
		# 2. HX startup
		# ============================================================

		if self.state == self.HEAT:
			hx_time = min(step, self.hx_startup_time * 10.0)

			if self.hx_startup_time > 0.0:
				hx_factor = 1.0 - math.exp(
					-hx_time / self.hx_startup_time
				)
			else:
				hx_factor = 1.0

			UA_eff = self.UA_hx * hx_factor

		else:
			UA_eff = 0.0

		# ============================================================
		# 3. Heat exchanger
		# ============================================================

		Q_hx_possible = UA_eff * (
			self.T_compr - self.T_return_sensor
		)

		# The physical heat pump cannot deliver more than its
		# rated thermal output.
		self.Q_in = min(
			Q_hx_possible,
			self.Q_hp_max
		)

		# ============================================================
		# 4. Radiator network
		# ============================================================

		self.Q_out = self.UA_rad * (
			self.T_supply - self.T_room
		)

		# ============================================================
		# 5. Water circuit energy balance
		# ============================================================

		dT_supply = (
			(self.Q_in - self.Q_out)
			/ (self.m_circuit * self.C_w)
		) * dt

		self.T_supply += dT_supply

		# ============================================================
		# 6. Radiator return temperature
		# ============================================================

		if self.mdot_w > 0.0:
			self.T_return = (
				self.T_supply
				- self.Q_out / (self.mdot_w * self.C_w)
			)
		else:
			self.T_return = self.T_supply

		# ============================================================
		# 7. Pipe transport delay
		# ============================================================

		self.t_inlet = self.T_return

		self.pipe_delay_line.append(self.t_inlet)

		self.T_return_sensor = self.pipe_delay_line[0]

		# ============================================================
		# 8. House thermal balance
		# ============================================================

		if self.T_ambient > 22.0:
			t_aeff = self.T_ambient + 12.0
		else:
			t_aeff = self.T_ambient


		Q_losses = self.UA_loss * (
			self.T_room - t_aeff
		)

		self.Q_net_house = self.Q_out - Q_losses

		dT_room = dt * self.Q_net_house / self.thermal_inertia_house

		self.T_room += dT_room

		# ============================================================
		# 9. Advance simulation time
		# ============================================================

		self.cur_t += dt

