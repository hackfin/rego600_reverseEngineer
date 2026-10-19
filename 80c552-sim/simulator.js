
let cpu = null;
let i2cBus = null;
let rtc = null;
let ext_wdt = null;

let CD4094_A = undefined;
let CD4094_B = undefined;

async function setCODE_LoadProfile_ResetCpu(codeData) {
    cpu.CODE = codeData;
    cpu.CODE_ORIGINAL = [...codeData];
    const hash = await sha256(codeData);
    const hashString = hex(hash, 32, false);
    //log("loaded firmware hash:" + hashString);
    //console.log("loaded firmware hash:" + hashString);
    setCurrentFirmwareProfile(hashString);
    cpu.reset();
    completeRebuildDisassembly();
}

async function initCpu() {
    i2cBus = new I2CBus();
        
    cpu = create_80c552({
        i2cBus:i2cBus
    });
    
    window.app.cpu = cpu;
    if (builtin_flashCodeData) {
        await setCODE_LoadProfile_ResetCpu(builtin_flashCodeData);
    }
    if(builtin_flashData) {
        cpu.bus.flash.loadImage(builtin_flashData);
    }

    ext_wdt = new TC1232({timeoutMs:1200});
    install_tc1232(cpu, ext_wdt, { st: pinNameToStruct("P4.1") });
    
    rtc = new DS1302();
    //const ds = traceDevice(new DS1302(), "DS1302");
    //rtc.setDateTime(); // set current time using system time
    rtc.useSystemTime = true;
    // this uses setInterval internally to handle the time update
    // if useSystemTime is true then each tick sets the time from the system clock
    // else it's completely simulated
    // when simulated it's possible to set the date/time from wichin the simulated system
    rtc.startClock(); 

	install_ds1302(cpu, rtc, {
        ce:   pinNameToStruct("P4.1"),
        sclk: pinNameToStruct("P1.3"),
        io:   pinNameToStruct("P1.1"),
	});

	CD4094_A = new ShiftOut4094();
	install_4094(cpu, CD4094_A, {
        data: pinNameToStruct("P1.4"),
        clk:  pinNameToStruct("P1.3"),
        str:  pinNameToStruct("P4.4"),
	}, "A");

    CD4094_B = new ShiftOut4094();
	install_4094(cpu, CD4094_B, {
        data: {port:CD4094_A.QS1, bit:0},
        clk:  pinNameToStruct("P1.3"),
        str:  pinNameToStruct("P4.4"),
	}, "B");


    //console.log(getValues(CD4051_mux_A_inputDefs));
    let heating_model = adc_sensors_init({
        MUXSEL_A: {port:CD4094_B.outputs, bit:0},
        MUXSEL_B: {port:CD4094_B.outputs, bit:1},
        MUXSEL_C: {port:CD4094_B.outputs, bit:2},
        MUXSEL_D: {port:CD4094_B.outputs, bit:3},
    });

	const shIn = new ShiftIn4021();
	install_4021(cpu, shIn, {
        pl:  pinNameToStruct("P4.5"),
        clk: pinNameToStruct("P4.7"),
        q:   pinNameToStruct("P1.5"),
	});

    let threephasestatesBackwardDir = [
        0x50, //0b01010000
        0x40, //0b01000000
        0x60, //0b01100000
        0x20, //0b00100000
        0x30, //0b00110000
        0x10  //0b00010000
    ];
    let threephasestatesForwardDir = [
        0x10, //0b00010000
        0x30, //0b00110000
        0x20, //0b00100000
        0x60, //0b01100000
        0x40, //0b01000000
        0x50, //0b01010000
    ];
    let phaseTicks = 0;
    let phaseStep = 0;
    function getCurrentStepValue() {
        return threephasestatesForwardDir[phaseStep];
    }
    shIn.inputs = getCurrentStepValue() | 0x00;
    let three_phase_50hz_simulation_seq_ticks = 3072; // 11050000Hz / 12cpu_machine_cycles / 50Hz / 6steps = 3072 cpu machine cycles
    cpu.external_hw_ticks.push((cycles) => {
        phaseTicks+=cycles;

        if (phaseTicks >= three_phase_50hz_simulation_seq_ticks) {
            phaseTicks -= three_phase_50hz_simulation_seq_ticks;

            phaseStep++;
            if (phaseStep >= 6) {
                phaseStep = 0;
            }

            shIn.inputs = getCurrentStepValue() | 0x00;
        }
    });

    cpu.PSW.setlistener.push((oldval, newval) => {
        let oldBank = oldval & 0x18;
        let newBank = newval & 0x18;
        if (oldBank !== newBank) {
            console.log(
                "PSW Bank switch at PC=" + hex(cpu.PC.get(), 4) +
                " : " +
                hex(oldBank) +
                " -> " +
                hex(newBank)
            );
        }
    });

    install_uart(cpu);

    set_uart_handler();

    log('80C552 instance created (32KB SRAM / 512KB AM29F040 flash on P4-selected external bus).');
    console.log(cpu);
}

function getCoreRegs() {
  return [
      ['PC', hex(cpu.PC.get(), 4)],
      ['SP', hex(cpu.SP.get())],
      ['DPTR', hex(cpu.DPTR.get(), 4)],
      ['A', hex(cpu.A.get())],
      ['B', hex(cpu.B.get())],
      ['R0', hex(cpu.R0.get())],
      ['R1', hex(cpu.R1.get())],
      ['R2', hex(cpu.R2.get())],
      ['R3', hex(cpu.R3.get())],
      ['R4', hex(cpu.R4.get())],
      ['R5', hex(cpu.R5.get())],
      ['R6', hex(cpu.R6.get())],
      ['R7', hex(cpu.R7.get())],
      ['PSW', hex(cpu.PSW.get())],
      ['error', cpu.error_info.code + (cpu.error_info.code ? ' @' + hex(cpu.error_info.addr,4) : '')],
  ];
}

function getPeripheralRegs() {
  return [
      ['IEN0', hex(cpu.IEN0.get())],
      ['IEN1', hex(cpu.IEN1.get())],
      ['ADCH', hex(cpu.ADCH.get())],
      ['ADCON', hex(cpu.ADCON.get())],
      ['S0CON', hex(cpu.S0CON.get())],
      ['S0BUF', hex(cpu.S0BUF.get())],
      ['S1STA', hex(cpu.S1STA.get())],
      ['S1CON', hex(cpu.S1CON.get())],
      ['TCON', hex(cpu.TCON.get())],
      ['TMOD', hex(cpu.TMOD.get())],
      ['TH0', hex(cpu.TH0.get())],
      ['TL0', hex(cpu.TL0.get())],
      ['P0', hex(cpu.P0.get())],
      ['P1', hex(cpu.P1.get())],
      ['P2', hex(cpu.P2.get())],
      ['P3', hex(cpu.P3.get())],
      ['P4', hex(cpu.P4.get())],
      ['P5', hex(cpu.P5.get())],
  ];
}

function getPowerOutputSignals() {
  return [
    ['SV1 CLOSE', readPinLatch(CD4094_A.outputs,0)?'on':'off'],
    ['SV1 OPEN', readPinLatch(CD4094_A.outputs,1)?'on':'off'],
    ['P1', readPinLatch(CD4094_A.outputs,3)?'on':'off'],
    ['P2', readPinLatch(CD4094_A.outputs,5)?'on':'off'],
    ['P3', readPinLatch(CD4094_A.outputs,7)?'on':'off'],
    ['COMP', readPinLatch(CD4094_A.outputs,6)?'on':'off'],
    ['VXV', readPinLatch(CD4094_A.outputs,4)?'on':'off'],
    ['EL3', readPinLatch(CD4094_A.outputs,2)?'on':'off'],
    ['EL6', readPinLatch(CD4094_B.outputs,5)?'on':'off'],
    ['SUM_LARM', readPinLatch(CD4094_B.outputs,4)?'on':'off'],
    ['LARM_LED', readPinLatch(CD4094_B.outputs,6)?'off':'on'],
  ];
}

function heating_state() {
	return readPinLatch(CD4094_A.outputs,6)
		& readPinLatch(CD4094_A.outputs,5) 
		& readPinLatch(CD4094_A.outputs,7);
}

function render(stepMode = false) {
    renderKeyValueTable(coreRegs_el, getCoreRegs());
    renderKeyValueTable(peripheralRegs_el, getPeripheralRegs());

    renderKeyValueTable(pwr_output_signals_el, getPowerOutputSignals());

    renderMemDumps();
    //render_LCD();
    //renderBus();

    for (let item of window.app.simulator.guirenderevents) {
        item();
    }
  
    setCurrentExecLine(cpu, stepMode);

}

let coreRegs_el;
let peripheralRegs_el;
let pwr_output_signals_el;

async function simulator_init() {
    if (window.app.simulator == undefined) {
        window.app.simulator = {guirenderevents:[]};
    }
    coreRegs_el = document.getElementById('coreRegs');
    peripheralRegs_el = document.getElementById('peripheralRegs');
    pwr_output_signals_el = document.getElementById('pwr_output_signals');

    await initCpu();

    init_memory_panels();

    init_service_interface_panel("service_interface");
    init_front_panel("front-panel");

    document.getElementById('btn_reset').onclick = () => { 
        cpu.reset();
        
        cpu.bus.sram.mem_write_use_map = new Uint32Array(cpu.bus.sram.size);
        cpu.bus.sram.mem_read_use_map = new Uint32Array(cpu.bus.sram.size);
        log('reset');
        render(true);
    };
    document.getElementById('btn_step').onclick = () => { cpu.next(1); render(true); };
    document.getElementById('btn_step100').onclick = () => { cpu.next(100); render(true); };
    document.getElementById('btn_step1000').onclick = () => { cpu.next(1000); render(true); };
    document.getElementById('btn_run').onclick = () => {
        if (cpu.running) return;
        cpu.running = true;
        document.getElementById('run_status').textContent = 'running...';
        init_SignalInputs();
        ext_wdt.startMonitoring();
        cpu.gui_render_handler = render;
        cpu.start_emulator_loop();
        return;
        
    };
    document.getElementById('btn_stop').onclick = stopRun;
    function stopRun() {
        cpu.running = false;
        ext_wdt.stopMonitoring();
        document.getElementById('run_status').textContent = '';
    }

    document.getElementById('btn_print_callstack').onclick = () => {
        console.log(cpu.getCallStackString());
    };
    disassembly_init();
    render();
    init_SignalInputs();

    //initProfiling();
}
