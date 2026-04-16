document.addEventListener('DOMContentLoaded', () => {
    const drivingMistakes = [];
    const notificationCenter = document.getElementById('notification-center');

    function logMistake(msg) {
        drivingMistakes.push(msg);

        // Voice Notification
        if (audioEnabled && 'speechSynthesis' in window) {
            // Cancel any previous speech so new alerts play immediately
            window.speechSynthesis.cancel();
            
            // Extract a short phrase for speech
            let speechText = msg;
            if (msg.includes("Over speed!")) speechText = "Over speed!";
            else if (msg.includes("obstacle in front of the car")) speechText = "Obstacle in front of the car!";
            else if (msg.includes("cant stop immediately because a car is coming behind")) speechText = "cant stop immediately because a car is coming behind";
            else if (msg.includes("FRONT AEB")) speechText = "Front emergency braking triggered!";
            else if (msg.includes("REAR AEB")) speechText = "Rear emergency braking triggered!";
            else if (msg.includes("Oversteering!")) speechText = "Over steering!";
            else if (msg.includes("Sudden braking")) speechText = "Sudden braking!";
            else if (msg.includes("without indicator")) speechText = "Turned without indicator!";
            else if (msg.includes("engage the parking brake")) speechText = "Please engage parking brake.";
            else if (msg.includes("stalls the engine")) speechText = "Engine stalled!";
            else if (msg.includes("Reverse while moving forward")) speechText = "Dangerous shift to reverse!";
            else if (msg.includes("Skipped a gear")) speechText = "Skipped a gear!";

            const utterance = new SpeechSynthesisUtterance(speechText);
            window.speechSynthesis.speak(utterance);
        }

        if (notificationCenter) {
            const el = document.createElement('div');
            el.className = 'notification-item';
            el.textContent = msg;
            notificationCenter.appendChild(el);
            setTimeout(() => {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 5000);
        }
    }

    // --- Initial Config ---
    let CAM_IP = localStorage.getItem('cam_ip') || '172.30.38.110';
    let ESP8266_IP = localStorage.getItem('esp_ip') || 'http://172.30.38.46';

    const fpvCamera = document.getElementById('fpv-camera');
    if (fpvCamera) {
        let camBaseUrl = CAM_IP.startsWith('http') ? CAM_IP : 'http://' + CAM_IP;
        fpvCamera.src = camBaseUrl + ':81/stream';
    }

    // --- ESP32-CAM Resolution Optimizer ---
    if (fpvCamera && fpvCamera.src.includes(':81/stream')) {
        try {
            const camUrl = new URL(fpvCamera.src);
            // Default ESP32-CAM web server has a control endpoint on port 80
            // framesize values: 4 = QVGA(320x240), 5 = CIF(400x296), 6 = VGA(640x480)
            const controlUrl = `${camUrl.protocol}//${camUrl.hostname}/control?var=framesize&val=4`; 
            
            // Set resolution to QVGA (smallest/fastest)
            fetch(controlUrl, { mode: 'no-cors' }).catch(err => console.log('Camera control fetch error:', err));
        } catch(e) {}
    }

    // --- Audio System ---
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx;
    let hornOsc1, hornOsc2, hornGain;
    let indicatorInterval;
    let audioEnabled = false;

    function initAudio() {
        if(!audioEnabled) {
            audioCtx = new AudioContext();
            audioEnabled = true;
        } else if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playTick() {
        if(!audioEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
    }

    function playGearShift() {
        if(!audioEnabled) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(100, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    }

    function startHorn() {
        if(!audioEnabled || hornOsc1) return;
        hornOsc1 = audioCtx.createOscillator();
        hornOsc2 = audioCtx.createOscillator();
        hornGain = audioCtx.createGain();
        hornOsc1.type = 'sawtooth';
        hornOsc1.frequency.value = 350;
        hornOsc2.type = 'square';
        hornOsc2.frequency.value = 400;
        hornGain.gain.value = 0.2;
        hornOsc1.connect(hornGain);
        hornOsc2.connect(hornGain);
        hornGain.connect(audioCtx.destination);
        hornOsc1.start();
        hornOsc2.start();
    }

    function stopHorn() {
        if(hornOsc1) {
            hornOsc1.stop(); hornOsc2.stop();
            hornOsc1 = null; hornOsc2 = null;
        }
    }

    // Must trigger on user interaction
    window.addEventListener('click', initAudio, {once: true});
    window.addEventListener('keydown', initAudio, {once: true});

    // --- UI Interactions ---

    // --- ESP8266 Server Configuration ---
    // ESP8266_IP is configured at the top of the file
    
    // Helper to send non-blocking HTTP GET requests to ESP8266
    function sendCommand(endpoint, params) {
        let url = new URL(ESP8266_IP + endpoint);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
        fetch(url, { mode: 'no-cors' }) // Fire and forget
            .catch(err => console.error('Communication Error:', err));
    }

    // Gear Shift Logic
    const gearBtns = Array.from(document.querySelectorAll('.gear-btn'));
    let currentGearIndex = 1; // 1 represents '1'
    let currentGearLabel = '1';

    gearBtns.forEach((btn, idx) => {
        btn.addEventListener('click', () => {
            const isClutchEngaged = document.getElementById('pedal-clutch').classList.contains('active');
            if(!isClutchEngaged) return; // Prevent shifting without clutch

            // Mistake Detection for Gears
            let targetLabel = btn.getAttribute('data-gear');
            if (currentGearLabel !== targetLabel) {
                if (targetLabel === 'R' && simSpeed > 5) {
                    logMistake(`Shifted into Reverse while moving forward at ${Math.round(simSpeed)} km/h! This is extremely dangerous for the transmission.`);
                } else if (currentGearLabel !== 'R' && targetLabel !== 'R') {
                    let oldG = parseInt(currentGearLabel);
                    let newG = parseInt(targetLabel);
                    if (newG - oldG > 1) {
                        logMistake(`Skipped a gear, shifting directly from ${oldG} to ${newG}. This lugs the engine.`);
                    }
                }
            }

            initAudio();
            playGearShift();
            gearBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentGearIndex = idx;
            currentGearLabel = targetLabel;
        });
    });

    // Auxillary Dashboard Panel Logic
    const auxState = { 'l': false, 'p': false, 'i': false, 'm': false };

    const uiAux = {
        'l': document.getElementById('btn-light'),
        'p': document.getElementById('btn-park'),
        'h': document.getElementById('btn-horn'), // Hold-to-activate
        'i': document.getElementById('btn-indicator'),
        'm': document.getElementById('btn-wiper'),
        'c': document.getElementById('btn-cruise')
    };

    const wiperSys = document.getElementById('wiper-system');

    function toggleAux(key) {
        initAudio(); 
        auxState[key] = !auxState[key];
        uiAux[key].classList.toggle('active', auxState[key]);

        if (key === 'm') {
            wiperSys.classList.toggle('active', auxState[key]);
        }
        if (key === 'i') {
            if (auxState['i']) {
                playTick();
                indicatorInterval = setInterval(playTick, 500);
            } else {
                clearInterval(indicatorInterval);
            }
        }
        if (key === 'p') {
            playGearShift(); // clunk sound
        }
    }

    // Bind mouse/touch for dashboard buttons
    uiAux['l'].addEventListener('click', () => toggleAux('l'));
    uiAux['p'].addEventListener('click', () => toggleAux('p'));
    uiAux['i'].addEventListener('click', () => toggleAux('i'));
    uiAux['m'].addEventListener('click', () => toggleAux('m'));
    if (uiAux['c']) {
        uiAux['c'].addEventListener('click', () => toggleCruise());
    }

    ['mousedown', 'touchstart'].forEach(evt => {
        uiAux['h'].addEventListener(evt, (e) => {
            if(e.cancelable) e.preventDefault();
            initAudio();
            uiAux['h'].classList.add('active');
            startHorn();
        }, {passive: false});
    });

    ['mouseup', 'mouseleave', 'touchend'].forEach(evt => {
        uiAux['h'].addEventListener(evt, () => {
            uiAux['h'].classList.remove('active');
            stopHorn();
        });
    });

    // Pedals Logic
    const throttlePedal = document.getElementById('pedal-throttle');
    const brakePedal = document.getElementById('pedal-brake');
    const clutchPedal = document.getElementById('pedal-clutch');

    function bindPedalEvents(pedalElement) {
        const activate = (e) => { 
            if(e.cancelable) e.preventDefault(); 
            pedalElement.classList.add('active'); 
        };
        const deactivate = (e) => { 
            if(e.cancelable) e.preventDefault(); 
            pedalElement.classList.remove('active'); 
        };
        
        pedalElement.addEventListener('mousedown', activate);
        pedalElement.addEventListener('mouseup', deactivate);
        pedalElement.addEventListener('mouseleave', deactivate);
        pedalElement.addEventListener('touchstart', activate, {passive: false});
        pedalElement.addEventListener('touchend', deactivate);
    }

    bindPedalEvents(throttlePedal);
    bindPedalEvents(brakePedal);
    bindPedalEvents(clutchPedal);

    // Steering Logic
    const wheel = document.getElementById('steering-wheel');
    const frame = document.getElementById('steering-frame');

    let dragging = false;
    let initialAngle = 0;
    let currentAngle = 0;
    let centerX, centerY;
    let autoSteerInterval = null;

    function updateCenter() {
        const rect = frame.getBoundingClientRect();
        centerX = rect.left + rect.width / 2;
        centerY = rect.top + rect.height / 2;
    }

    updateCenter();
    window.addEventListener('resize', updateCenter);

    function calculateAngle(event) {
        let clientX = event.clientX, clientY = event.clientY;
        if (event.touches && event.touches.length > 0) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        }
        return Math.atan2(clientY - centerY, clientX - centerX) * (180 / Math.PI);
    }

    function setWheelAngle(angle) {
        if (angle > 180) angle = 180;
        if (angle < -180) angle = -180;
        currentAngle = angle;
        wheel.style.transform = `rotate(${currentAngle}deg)`;
    }

    function startDrag(e) {
        clearInterval(autoSteerInterval); 
        dragging = true;
        updateCenter();
        const mouseAngle = calculateAngle(e);
        initialAngle = mouseAngle - currentAngle;
        wheel.classList.remove('smooth-return');
        if (e.type !== 'touchstart' && e.cancelable) e.preventDefault(); 
    }

    function doDrag(e) {
        if (!dragging) return;
        let angle = calculateAngle(e) - initialAngle;
        
        if (angle > 180) angle -= 360;
        if (angle < -180) angle += 360;

        setWheelAngle(angle);
        if (e.type !== 'touchmove' && e.cancelable) e.preventDefault();
    }

    function stopDrag() {
        if (dragging) {
            dragging = false;
            wheel.classList.add('smooth-return');
            setWheelAngle(0);
        }
    }

    wheel.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', doDrag);
    window.addEventListener('mouseup', stopDrag);

    wheel.addEventListener('touchstart', startDrag, {passive: false});
    window.addEventListener('touchmove', doDrag, {passive: false});
    window.addEventListener('touchend', stopDrag);


    // Global Keyboard Bindings Logic
    const keysMap = {
        'w': false,
        's': false,
        'f': false,
        'ArrowLeft': false,
        'ArrowRight': false
    };

    const STEERING_SPEED = 6;

    window.addEventListener('keydown', (e) => {
        let k = e.key;
        if (k.length === 1) k = k.toLowerCase();

        // 1-off triggers for toggles / holds
        if (!e.repeat) {
            if (k === 'l') toggleAux('l');
            if (k === 'p') toggleAux('p');
            if (k === 'i') toggleAux('i');
            if (k === 'm') toggleAux('m');
            if (k === 'c') toggleCruise();
            if (k === 'h') {
                uiAux['h'].classList.add('active');
                startHorn();
            }
            if (e.key === 'ArrowUp') {
                const isClutchEngaged = document.getElementById('pedal-clutch').classList.contains('active');
                if (currentGearIndex < gearBtns.length - 1 && isClutchEngaged) {
                    gearBtns[currentGearIndex + 1].click();
                }
            }
            if (e.key === 'ArrowDown') {
                const isClutchEngaged = document.getElementById('pedal-clutch').classList.contains('active');
                if (currentGearIndex > 0 && isClutchEngaged) {
                    gearBtns[currentGearIndex - 1].click();
                }
            }
        }

        // Continuous state trackers for pedals & steering
        if (keysMap.hasOwnProperty(k) && !keysMap[k]) {
            keysMap[k] = true;

            if (k === 'w') throttlePedal.classList.add('active');
            if (k === 's') brakePedal.classList.add('active');
            if (k === 'f') clutchPedal.classList.add('active');
            
            if (k === 'ArrowLeft' || k === 'ArrowRight') {
                clearInterval(autoSteerInterval);
                wheel.classList.remove('smooth-return');
                
                autoSteerInterval = setInterval(() => {
                    let step = (keysMap['ArrowRight'] ? STEERING_SPEED : 0) - (keysMap['ArrowLeft'] ? STEERING_SPEED : 0);
                    if (step !== 0) setWheelAngle(currentAngle + step);
                }, 16);
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        let k = e.key;
        if (k.length === 1) k = k.toLowerCase();

        if (k === 'h') {
            uiAux['h'].classList.remove('active');
            stopHorn();
        }

        if (keysMap.hasOwnProperty(k)) {
            keysMap[k] = false;

            if (k === 'w') throttlePedal.classList.remove('active');
            if (k === 's') brakePedal.classList.remove('active');
            if (k === 'f') clutchPedal.classList.remove('active');

            if ((k === 'ArrowLeft' && !keysMap['ArrowRight']) || 
                (k === 'ArrowRight' && !keysMap['ArrowLeft'])) {
                clearInterval(autoSteerInterval);
                if (!dragging) {
                    wheel.classList.add('smooth-return');
                    setWheelAngle(0);
                }
            }
        }
    });

    // Cruise Control State
    let cruiseActive = false;
    let cruiseSpeed = 0;

    function toggleCruise() {
        if (cruiseActive) {
            cruiseActive = false;
            uiAux['c'].classList.remove('active');
            
            // Show notification
            const el = document.createElement('div');
            el.className = 'notification-item';
            el.textContent = "Cruise control deactivated.";
            notificationCenter.appendChild(el);
            setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 5000);
            
            if (audioEnabled && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(new SpeechSynthesisUtterance("Cruise control deactivated"));
            }
        } else {
            if (simSpeed > 10 && currentGearLabel !== 'R') {
                cruiseActive = true;
                cruiseSpeed = simSpeed;
                uiAux['c'].classList.add('active');
                
                const el = document.createElement('div');
                el.className = 'notification-item';
                el.textContent = `Cruise control engaged at ${Math.round(cruiseSpeed)} km/h.`;
                notificationCenter.appendChild(el);
                setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 5000);

                if (audioEnabled && 'speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                    window.speechSynthesis.speak(new SpeechSynthesisUtterance("Cruise control engaged"));
                }
            } else {
                const el = document.createElement('div');
                el.className = 'notification-item';
                el.textContent = "Speed too low to engage cruise control.";
                notificationCenter.appendChild(el);
                setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 5000);
            }
        }
    }

    // Dashboard Engine Simulation Logic
    let simSpeed = 0, simRpm = 800;
    let fuelLevel = 100;
    const needleSpeed = document.getElementById('needle-speed');
    const needleRpm = document.getElementById('needle-rpm');
    const needleFuel = document.getElementById('needle-fuel');
    const valSpeed = document.getElementById('speed-val');
    const valRpm = document.getElementById('rpm-val');
    const valFuel = document.getElementById('fuel-val');

    const gearMaxSpeed = {
        'R': 15,
        '1': 20,
        '2': 45,
        '3': 85,
        '4': 160
    };

    setInterval(() => {
        let throttling = keysMap['w'] || throttlePedal.classList.contains('active');
        let braking = keysMap['s'] || brakePedal.classList.contains('active');
        let clutching = keysMap['f'] || clutchPedal.classList.contains('active');

        // Disengage cruise control if user presses a pedal
        if (cruiseActive && (throttling || braking || clutching)) {
            toggleCruise(); // This will deactivate since cruiseActive is true
        }

        let maxSpeed = gearMaxSpeed[currentGearLabel] || 0;
        
        if (clutching) {
            if (throttling) {
                simRpm += 300;
                fuelLevel -= 0.05;
            } else {
                simRpm -= 100;
            }
            simSpeed -= 0.05; 
        } else {
            if (cruiseActive) {
                if (simSpeed < cruiseSpeed) {
                    simSpeed += 0.4;
                } else if (simSpeed > cruiseSpeed) {
                    simSpeed -= 0.2;
                }
                fuelLevel -= 0.015;
                
                let speedRatio = simSpeed / maxSpeed;
                if (speedRatio < 0) speedRatio = 0;
                if (speedRatio > 1.1) speedRatio = 1.1; 
                let targetRpm = 800 + (speedRatio * 6000); 
                simRpm += (targetRpm - simRpm) * 0.2;
            } else {
                if (throttling) {
                    if (simSpeed < maxSpeed) {
                        simSpeed += 0.4;
                    }
                    fuelLevel -= 0.02;
                } else {
                    simSpeed -= 0.2;
                }
                
                let speedRatio = simSpeed / maxSpeed;
                if (speedRatio < 0) speedRatio = 0;
                if (speedRatio > 1.1) speedRatio = 1.1; 
                
                let targetRpm = 800 + (speedRatio * 6000); 
                simRpm += (targetRpm - simRpm) * 0.2;
            }
        }

        if (braking) {
            simSpeed -= 1.2;
        }

        if (simSpeed < 0) simSpeed = 0;
        if (simRpm < 800) simRpm = 800;
        if (simRpm > 8000) simRpm = 8000;
        if (fuelLevel < 0) fuelLevel = 0;

        if (valSpeed) valSpeed.textContent = Math.round(simSpeed);
        if (valRpm) valRpm.textContent = Math.round(simRpm);
        if (valFuel) valFuel.textContent = Math.round(fuelLevel);

        let speedDeg = -135 + (simSpeed / 160) * 270;
        let rpmDeg = -135 + (simRpm / 8000) * 270;
        let fuelDeg = -135 + (fuelLevel / 100) * 270; 

        if (needleSpeed) needleSpeed.style.transform = `rotate(${speedDeg}deg)`;
        if (needleRpm) needleRpm.style.transform = `rotate(${rpmDeg}deg)`;
        if (needleFuel) needleFuel.style.transform = `rotate(${fuelDeg}deg)`;
        
    }, 30);

    // Continuous Unified State Transmission with Anti-Flood Logic
    let lastDriveState = { steer: null, throttle: null, brake: null, clutch: null, light: null, wiper: null, park: null, horn: null, indicator: null, gear: null };
    let isSendingDrive = false;

    let lastSendTime = 0;

    setInterval(async () => {
        let clutching = keysMap['f'] || clutchPedal.classList.contains('active') ? 1 : 0;
        let braking = keysMap['s'] || brakePedal.classList.contains('active') ? 1 : 0;
        let steerAngle = Math.round(currentAngle);
        let throttleSpeed = Math.round(simSpeed); 
        
        let lightV = auxState['l'] ? 1 : 0;
        let wiperV = auxState['m'] ? 1 : 0;
        let parkV = auxState['p'] ? 1 : 0;
        let indicatorV = auxState['i'] ? 1 : 0;
        let hornV = uiAux['h'].classList.contains('active') ? 1 : 0;
        let gearV = currentGearLabel;
        
        // Only send if the state has structurally changed (with a threshold for continuous values to prevent spam)
        let stateChanged = false;
        
        if (Math.abs(steerAngle - (lastDriveState.steer || 0)) > 5) stateChanged = true;
        if (Math.abs(throttleSpeed - (lastDriveState.throttle || 0)) > 5) stateChanged = true;
        if (braking !== lastDriveState.brake) stateChanged = true;
        if (clutching !== lastDriveState.clutch) stateChanged = true;
        if (lightV !== lastDriveState.light) stateChanged = true;
        if (wiperV !== lastDriveState.wiper) stateChanged = true;
        if (parkV !== lastDriveState.park) stateChanged = true;
        if (hornV !== lastDriveState.horn) stateChanged = true;
        if (indicatorV !== lastDriveState.indicator) stateChanged = true;
        if (gearV !== lastDriveState.gear) stateChanged = true;

        // Force an update every 1 second just in case
        let now = Date.now();
        if (now - lastSendTime > 1000) stateChanged = true;

        if (!stateChanged) return;

        // Drop frame if the ESP8266 is still processing the last packet!
        if (isSendingDrive) return; 

        isSendingDrive = true;
        lastSendTime = now;
        
        lastDriveState = { 
            steer: steerAngle, throttle: throttleSpeed, brake: braking, clutch: clutching,
            light: lightV, wiper: wiperV, park: parkV, horn: hornV, indicator: indicatorV, gear: gearV
        };

        let url = new URL(ESP8266_IP + '/drive');
        url.searchParams.append('steer', steerAngle);
        url.searchParams.append('throttle', throttleSpeed);
        url.searchParams.append('brake', braking);
        url.searchParams.append('clutch', clutching);
        url.searchParams.append('light', lightV);
        url.searchParams.append('wiper', wiperV);
        url.searchParams.append('park', parkV);
        url.searchParams.append('horn', hornV);
        url.searchParams.append('indicator', indicatorV);
        url.searchParams.append('gear', gearV);

        try {
            await fetch(url, { mode: 'no-cors' });
        } catch (err) { } finally {
            isSendingDrive = false;
        }
    }, 150);

    // --- AI Driving Instructor Module / Settings ---
    const btnSettings = document.getElementById('btn-settings');
    const btnAnalyze = document.getElementById('btn-analyze');
    const modalSettings = document.getElementById('modal-settings');
    const modalAiFeedback = document.getElementById('modal-ai-feedback');
    const closeSettings = document.getElementById('close-settings');
    const closeAiFeedback = document.getElementById('close-ai-feedback');
    const geminiInput = document.getElementById('gemini-api-key');
    const camIpInput = document.getElementById('cam-ip');
    const espIpInput = document.getElementById('esp-ip');
    const saveSettings = document.getElementById('save-settings');
    const aiFeedbackContent = document.getElementById('ai-feedback-content');

    // UI Bindings
    if (btnSettings && modalSettings) {
        btnSettings.addEventListener('click', () => {
            if (camIpInput) camIpInput.value = localStorage.getItem('cam_ip') || CAM_IP;
            if (espIpInput) espIpInput.value = localStorage.getItem('esp_ip') || ESP8266_IP;
            geminiInput.value = localStorage.getItem('gemini_api_key') || '';
            modalSettings.classList.add('active');
        });
        closeSettings.addEventListener('click', () => modalSettings.classList.remove('active'));
        saveSettings.addEventListener('click', () => {
            if (camIpInput) {
                let cip = camIpInput.value.trim();
                if (cip) {
                    localStorage.setItem('cam_ip', cip);
                    CAM_IP = cip;
                    let camBaseUrl = CAM_IP.startsWith('http') ? CAM_IP : 'http://' + CAM_IP;
                    if (fpvCamera) fpvCamera.src = camBaseUrl + ':81/stream';
                }
            }
            if (espIpInput) {
                let eip = espIpInput.value.trim();
                if (eip) {
                    if (!eip.startsWith('http')) eip = 'http://' + eip;
                    localStorage.setItem('esp_ip', eip);
                    ESP8266_IP = eip;
                }
            }
            localStorage.setItem('gemini_api_key', geminiInput.value);
            modalSettings.classList.remove('active');
        });
    }

    if (btnAnalyze && modalAiFeedback) {
        btnAnalyze.addEventListener('click', async () => {
            modalAiFeedback.classList.add('active');
            aiFeedbackContent.innerHTML = '<p>Analyzing your session...</p>';
            const apiKey = localStorage.getItem('gemini_api_key');
            if (!apiKey) {
                aiFeedbackContent.innerHTML = '<p>Error: Please enter your Gemini API Key in Settings first.</p>';
                return;
            }
            if (drivingMistakes.length === 0) {
                aiFeedbackContent.innerHTML = '<p>No mistakes detected yet! Keep up the good driving!</p>';
                return;
            }

            try {
                const prompt = `You are a friendly, humanizing driving instructor analyzing a student's RC car session. The student made these exact mistakes:\n\n${drivingMistakes.map((m, i) => `${i+1}. ${m}`).join('\n')}\n\nAct like a real driving instructor. Give conversational, encouraging, yet corrective feedback. Explain exactly why these mistakes are bad practice in a real car context. Please use HTML tags like <p>, <strong>, etc for readability instead of markdown. Keep it under 200 words.`;
                
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                });

                const data = await response.json();
                if (data.error) {
                    aiFeedbackContent.innerHTML = `<p>Error: ${data.error.message}</p>`;
                } else {
                    const text = data.candidates[0].content.parts[0].text;
                    aiFeedbackContent.innerHTML = text.replace(/```html|```/g, '');
                    // Clear mistakes to start fresh next session
                    drivingMistakes.length = 0;
                }
            } catch (err) {
                aiFeedbackContent.innerHTML = `<p>Failed to connect to AI: ${err.message}</p>`;
            }
        });
        closeAiFeedback.addEventListener('click', () => modalAiFeedback.classList.remove('active'));
    }

    // Mistake Detection Loop
    let lastSteerMistake = 0;
    let lastBrakeMistake = 0;
    let lastOversteerMistake = 0;
    let stopTime = null;
    let lastParkMistake = 0;
    let lastGearStallMistake = 0;
    let lastOverspeedMistake = 0;

    setInterval(() => {
        let throttling = keysMap['w'] || throttlePedal.classList.contains('active');
        let braking = keysMap['s'] || brakePedal.classList.contains('active');
        let indicatorActive = auxState['i'];
        let parkActive = auxState['p'];

        // Turning without indicator
        if (Math.abs(currentAngle) > 25 && !indicatorActive && throttling) {
            if (Date.now() - lastSteerMistake > 5000) {
                logMistake(`Turned without indicator (${Math.round(currentAngle)}°).`);
                lastSteerMistake = Date.now();
            }
        }

        // Sudden braking at high speed
        if (braking && simSpeed > 40) {
            if (Date.now() - lastBrakeMistake > 5000) {
                logMistake(`Sudden braking at ${Math.round(simSpeed)} km/h.`);
                lastBrakeMistake = Date.now();
            }
        }

        // Oversteering at high speed
        if (simSpeed > 40 && Math.abs(currentAngle) > 60) {
            if (Date.now() - lastOversteerMistake > 5000) {
                logMistake(`Oversteering! Angle ${Math.round(currentAngle)}° is too high for ${Math.round(simSpeed)} km/h.`);
                lastOversteerMistake = Date.now();
            }
        }

        // Overspeeding (> 80 km/h)
        if (simSpeed > 80) {
            if (Date.now() - lastOverspeedMistake > 5000) {
                logMistake(`Over speed! You are driving at ${Math.round(simSpeed)} km/h. Please slow down.`);
                lastOverspeedMistake = Date.now();
            }
        }

        // Engine Stall on High Gear Start
        if (throttling && simSpeed < 2 && (currentGearLabel === '3' || currentGearLabel === '4')) {
            if (Date.now() - lastGearStallMistake > 5000) {
                logMistake(`Tried to accelerate from a dead stop in gear ${currentGearLabel}. This stalls the engine!`);
                lastGearStallMistake = Date.now();
            }
        }

        // Parking brake while parked/stopped
        if (simSpeed < 2) {
            if (!stopTime) stopTime = Date.now();
            else if (Date.now() - stopTime > 5000 && !parkActive && !throttling && currentGearLabel !== 'R') {
                if (Date.now() - lastParkMistake > 8000) {
                    logMistake(`Car is idle. Please engage the parking brake (P).`);
                    lastParkMistake = Date.now();
                }
            }
        } else {
            stopTime = null;
        }

    }, 200);

    // --- AEB (Autonomous Emergency Braking) System ---
    let aebActive = false;
    let rearTailgateWarned = false;

    setInterval(async () => {
        try {
            const resp = await fetch(ESP8266_IP + '/sensors');
            const data = await resp.json();
            
            let movingForward = keysMap['w'] || throttlePedal.classList.contains('active');
            let braking = keysMap['s'] || brakePedal.classList.contains('active');
            let isReverse = currentGearLabel === 'R';

            // Front collision avoidance
            if (data.front < 20 && movingForward && !isReverse) {
                simSpeed = 0;
                keysMap['w'] = false;
                throttlePedal.classList.remove('active');
                if (!aebActive) {
                    logMistake(`obstacle in front of the car`);
                    playTick();
                    aebActive = true;
                }
            } 
            // Rear collision avoidance
            else if (data.back < 20 && isReverse && movingForward) { 
                simSpeed = 0;
                keysMap['w'] = false;
                throttlePedal.classList.remove('active');
                if (!aebActive) {
                    logMistake(`🚨 REAR AEB TRIGGERED! Obstacle at ${Math.round(data.back)}cm. Auto-braking applied.`);
                    playTick();
                    aebActive = true;
                }
            } else {
                aebActive = false;
            }

            // Tailgate warning logic
            if (data.back < 40 && !isReverse && simSpeed > 2) {
                if (braking) {
                    if (!rearTailgateWarned) {
                        logMistake(`cant stop immediately because a car is coming behind`);
                        playTick();
                        rearTailgateWarned = true;
                    }
                } else {
                    rearTailgateWarned = false;
                }
            } else {
                rearTailgateWarned = false;
            }
        } catch (e) {
            // Ignore failures if ESP is unavailable or sensors aren't wired yet
        }
    }, 200);
});
