
let ADC_MAX_VALUE = 1023;
let ADC_MIN_VALUE = 0;

let use_hm = false;

function binaryStateConvert(value) {
    return value ? ADC_MIN_VALUE : ADC_MAX_VALUE;
}
function invertedBinaryStateConvert(value) {
    return value ? ADC_MAX_VALUE : ADC_MIN_VALUE;
}

function setSimulation(value) {

	console.log(`Simulation ${value}`);
	use_hm = value;
}


function rawValue(val) { return val; }
function rego600_reverse_Temp_to_ADC_val(temp) {
  let addressOffset = curr_firmware.adc_lookup_table_addr;
  let indexOffset = curr_firmware.adc_lookup_table_index_offset;
  let bestIndex = -1;
  let bestDiff = Infinity;

  temp *= 10;
  //console.log(`--- LUT search for ${temp} ---`);
  for (let index = 0; index < 1024; index++) {
    let addr = index * 2 + addressOffset;
    let val = (cpu.CODE[addr] << 8) | cpu.CODE[addr + 1];
    //console.log(`checking value: ${val} @ addr:${hex(addr,4)}`)
    let diff = Math.abs(val - temp);

    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
      if (diff === 0) break; // exact hit cannot be better
    }
  }
//console.log(     `BEST: index=${bestIndex} adc=${bestIndex + indexOffset} ` +    `diff=${bestDiff}`  );
  return bestIndex === -1 ? -1 : bestIndex + indexOffset;
}
let CD4051_mux_A_inputDefs = { 
  0:{name:"EXT",  value:false,   channel:-1, connected:false, note:"external control input (binary states only)", valTransferFunction:binaryStateConvert},
  1:{name:"GT5",  value:21.6,    channel:7, connected:true, note:"Room", valTransferFunction:rego600_reverse_Temp_to_ADC_val},
  2:{name:"GT4",  value:0.0,     channel:-1, connected:false, note:"Radiator Forward", valTransferFunction:rego600_reverse_Temp_to_ADC_val},
  3:{name:"GT11", value:19.8,    channel:-1, connected:true, note:"Cold fluid out", valTransferFunction:rego600_reverse_Temp_to_ADC_val},
  4:{name:"GT3X", value:0.0,     channel:-1, connected:false, note:"external hot water", valTransferFunction:rego600_reverse_Temp_to_ADC_val},
  5:{name:"GT1",  value:20.9,    channel:0, connected:true, note:"Radiator Return", valTransferFunction:rego600_reverse_Temp_to_ADC_val},
  6:{name:"GT2",  value:22.1,    channel:1, connected:true, note:"Outdoor", valTransferFunction:rego600_reverse_Temp_to_ADC_val},
  7:{name:"LP",   value:false,   channel:-1, connected:true, note:"Low Pressure is High", valTransferFunction:invertedBinaryStateConvert}
};
let CD4051_mux_B_inputDefs = { 
  0:{name:"HP",     value:false, channel:-1, connected:true,  note:"High Pressure is High", valTransferFunction:invertedBinaryStateConvert},
  1:{name:"SP_ADC", value:0.0,   channel:-1, connected:false, note:"Service port ADC input", valTransferFunction:rawValue},
  2:{name:"GT10",   value:19.7,  channel:-1, connected:true,  note:"Cold fluid in", valTransferFunction:rego600_reverse_Temp_to_ADC_val},
  3:{name:"GT8",    value:21.7,  channel:2, connected:true,  note:"Heat fluid out", valTransferFunction:rego600_reverse_Temp_to_ADC_val},
  4:{name:"GT6",    value:20.0,  channel:4, connected:true,  note:"Compressor - high pressure side", valTransferFunction:rego600_reverse_Temp_to_ADC_val},
  5:{name:"GT3",    value:55.3,  channel:5, connected:true,  note:"Hot water", valTransferFunction:rego600_reverse_Temp_to_ADC_val},
  6:{name:"VVP",    value:false, channel:-1, connected:false, note:"Pressure safety switch of unknown use", valTransferFunction:invertedBinaryStateConvert},
  7:{name:"GT9",    value:20.2,  channel:3, connected:true,  note:"Heat fluid in", valTransferFunction:rego600_reverse_Temp_to_ADC_val}
};

function getValues(inputDefs)
{
    // Obtains initial values, only called at startup.
    let values = [];

    for (let i = 0; i < 8; i++) {
        const input = inputDefs[i];
		// console.log(`ADC input init ${input.name}: value=${input.value}, connected=${input.connected}`);
        
        if (!input || !input.connected) {
			values[i] = ADC_MAX_VALUE;
        } else {
            values[i] = input.valTransferFunction(input.value);
        }
    }

    return values;
}

function init_SignalInputs() {
    const div = document.getElementById('input_signals');

	hm = window.app.heating_model;


    let html = '';

    for (let ch = 0; ch < 16; ++ch) {
        const defs = ch < 8
            ? CD4051_mux_A_inputDefs
            : CD4051_mux_B_inputDefs;

        const input = defs[ch % 8];
        if (input === undefined) { continue; }

        html += `
        <div style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox"
                  ${input.connected ? 'checked' : ''}
                  onchange="setAdcChannelConnected(${ch}, this.checked)">

            <label style="width:50px;" title="${input.note}">
                ${input.name}
            </label>
        `
        if (typeof input.value != "boolean") {
            html += `
                <input title="${input.note}"
                    style="width:50px;${(input.channel != -1 && use_hm && !input.connected) ? 'background-color:#caa03f;' : ''}"
                    type="number"
                    step="0.1"
                    min="-40"
                    max="140"
                    value="${input.value}"
                    ${!input.connected ? 'disabled' : ''}
                    style="width:70px"
                    onchange="setAdcChannel(${ch}, this.value)">
            
            `;
        }
        html += "</div>";
    }

    div.innerHTML = html;
}

function updateAdcChannel(ch) {
    const defs = ch < 8
        ? CD4051_mux_A_inputDefs
        : CD4051_mux_B_inputDefs;

    const index = ch % 8;
    const input = defs[index];

    const adcValue = (input.connected | use_hm)
        ? input.valTransferFunction(input.value)
        : ADC_MAX_VALUE;

    if (ch < 8)
        window.app.CD4051_mux_A.X[index] = adcValue;
    else
        window.app.CD4051_mux_B.X[index] = adcValue;
}
function setAdcChannel(ch, value) {
    const defs = ch < 8
        ? CD4051_mux_A_inputDefs
        : CD4051_mux_B_inputDefs;

    const input = defs[ch % 8];

    input.value = parseFloat(value);
    updateAdcChannel(ch);
}

function setAdcChannelConnected(ch, connected) {
    const defs = ch < 8
        ? CD4051_mux_A_inputDefs
        : CD4051_mux_B_inputDefs;

    const input = defs[ch % 8];

    input.connected = connected;
    updateAdcChannel(ch);
    init_SignalInputs();
}

function updateTemperatures(context) {

	// console.log(`CALL UPDATE ${use_hm}, ${context.T}`);
	if (!use_hm || context.T == null) return;

	context.T.forEach((t, i) => {
        const entry = context.map[i];

        if (entry != undefined) {
			const ch = entry[0];
			const input = entry[1];
			// if we're not "connected", we're automated
			if (!input.connected) {
				input.value = t;
				updateAdcChannel(ch);
				console.log(`ADC update ${input.name}: channel=${ch} = ${t}`);
			}
		}
	});


}

function adc_sensors_init({MUXSEL_A, MUXSEL_B, MUXSEL_C, MUXSEL_D}) {

	map = {}
	for (const [key, value] of Object.entries(CD4051_mux_A_inputDefs)) {
		if (value.channel != -1) {
			 console.log("ENTRY A", +key, value);
			map[value.channel] = [ +key, value ];
		}
	}
	for (const [key, value] of Object.entries(CD4051_mux_B_inputDefs)) {
		if (value.channel != -1) {
			 console.log("ENTRY B", +key + 8, value);
			map[value.channel] = [ +key + 8, value ];
		}
	}

	hm = new TemperatureClient("ws://127.0.0.1:8765", updateTemperatures, map);
	
	window.app.heating_model = hm;

    const div = document.getElementById('heating_model');
	html = `
		<div class="status">
			<span id="connection-dot" class="dot"></span>
			<span id="connection">Connecting...</span>
		</div>
		<div style="display:flex; align-items:center; gap:8px;">
			<fieldset id="hm_enable"><b>Auto-Update</b>

			<input type="checkbox"
				  onchange="setSimulation(this.checked)">
			</fieldset>
		</div>
        `
    div.innerHTML = html;
	
	hm.connect();

    window.app.CD4051_mux_A = new CD4051({
    A: MUXSEL_A,
    B: MUXSEL_B,
    C: MUXSEL_C,
    INH: MUXSEL_D,
  }, getValues(CD4051_mux_A_inputDefs), "A");


  const mux_B_Invert_INH = new Inverter(MUXSEL_D);
  
  window.app.CD4051_mux_B = new CD4051({
    A: MUXSEL_A,
    B: MUXSEL_B,
    C: MUXSEL_C,
    INH: {port:mux_B_Invert_INH, bit:0},
  }, getValues(CD4051_mux_B_inputDefs), "B");

  // executes after every instruction so it's perfect to use for adc selection
  window.app.cpu.external_hw_ticks.push(() => {

    if (readPinLatch(CD4094_B.outputs, 3) === 0) {
      window.app.cpu.adc.setChannelValue(0, window.app.CD4051_mux_A.get());
    } else {
     // console.log("do this happend:" + mux_B_Invert_INH.get() + CD4051_mux_B.get());
      window.app.cpu.adc.setChannelValue(0, window.app.CD4051_mux_B.get());
    }
    
  });

}
