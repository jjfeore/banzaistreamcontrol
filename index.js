const player = require('play-sound')(opts = {player: 'mpg123'});
const tmi = require('tmi.js');
const dotenv = require('dotenv');
const huejay = require('huejay');
const tplink = require('tplink-smarthome-api');
const wemo = require('wemo-client');
const WebSocket = require('ws');
const OBSWebSocket = require('obs-websocket-js');

dotenv.config();

const hueColor = {
	deeppurple: 49316,
	lightpurple: 56228,
	red: 65535,
	blue: 46920,
	green: 25500,
	orange: 9992
};

// Configure OBS websocket
const obs = new OBSWebSocket();
let currentScene = 'Starting Soon';

obs.connect({
    address: 'localhost:4444',
    password: process.env.OBS_WS_PASS
}).then(() => {
    console.log(`Connected to OBS via Websocket`);
}).catch(err => {
    console.log('Error on OBS Websocket connect: ' + err);
});

obs.on('ConnectionOpened', () => {
	obs.send('GetCurrentScene').then((data) => {
		console.log(`OBS Websocket: Setting current scene to ${data.name}`);
		currentScene = data.name;
	}).catch(err => {
		console.log('OBS Websocket Error: ' + err);
	});
});
  
obs.on('SwitchScenes', data => {
	console.log(`OBS Websocket: Setting current scene to ${data['scene-name']}`);
	currentScene = data['scene-name'];
});

// Source: https://www.thepolyglotdeveloper.com/2015/03/create-a-random-nonce-string-using-javascript/
function nonce(length) {
    let text = "";
    let possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// Configure WebSocket for Twitch PubSub
let ws;

function wsHeartbeat() {
    message = {
        type: 'PING'
    };
    console.log('WebSocket PING Sent');
    ws.send(JSON.stringify(message));
}

function wsListen(topic) {
    message = {
        type: 'LISTEN',
        nonce: nonce(15),
        data: {
            topics: [topic],
            auth_token: process.env.TWITCH_APP_OAUTH
        }
	};
	let stringified = JSON.stringify(message);
    console.log('Websocket Sent: ' + stringified);
    ws.send(stringified);
}

function wsConnect() {
    let heartbeatInterval = 60000;
    let reconnectInterval = 3000;
    let heartbeatHandle;

    ws = new WebSocket('wss://pubsub-edge.twitch.tv');

    ws.on('open', function() {
        console.log('WebSocket Opened');
        wsHeartbeat();
		heartbeatHandle = setInterval(wsHeartbeat, heartbeatInterval);
		wsListen(`channel-points-channel-v1.${process.env.TWITCH_CHANNEL_ID}`);
    });

    ws.on('error', function(error) {
        console.log('Websocket Error: ' + error);
    });

    ws.on('message', function(data) {
        message = JSON.parse(data);
        console.log('WebSocket Received: ' + data);
        if (message.type == 'RECONNECT') {
            console.log('WebSocket Reconnecting...');
            setTimeout(connect, reconnectInterval);
		}
		else if (message.type == 'MESSAGE' && message.data && message.data.message) {
			let messageParsed = JSON.parse(message.data.message);
			if (messageParsed.type && messageParsed.data && messageParsed.type == 'reward-redeemed') {
				redeemReward(messageParsed.data);
			}
		}
    });

    ws.on('close', function(code, reason) {
        console.log('WebSocket Closed: ' + reason);
        clearInterval(heartbeatHandle);
        console.log('WebSocket Reconnecting...');
        setTimeout(connect, reconnectInterval);
    });
}

wsConnect();

// Connect to the Philips Hue bridge
const hueClient = new huejay.Client({
	host:     '192.168.1.2',
	username: 'CEnnQq8TDPSVcl8SbpptgSnD4aKAdVuooPjlElEF'
});

// Uncomment and run the following method to get the IDs of all connected lights
// hueClient.lights.getAll()
//   .then(lights => {
//     for (let light of lights) {
//       console.log(`Light [${light.id}]: ${light.name}`);
//     }
//   });

// Connect to the Wemo Mini Smart Plug
const wemoClient = new wemo();
let wemoConnection;

wemoClient.load('http://192.168.1.21:49153/setup.xml', function(err, deviceInfo) {
  console.log('Wemo PLUG FOUND');
  wemoConnection = wemoClient.client(deviceInfo);

  wemoConnection.on('error', function(err) {
    console.log('WEMO PLUG ERROR: %s', err.code);
  });

  wemoConnection.on('binaryState', function(value) {
    console.log('WEMO PLUG: Binary State changed to: %s', value);
  });
});


// Connect to TP-Link Wifi Power Strip (HS300) and save the plugs
const tplinkClient = new tplink.Client();
let childPlugs = [null, null, null, null, null, null];

(async () => {
	const device = await tplinkClient.getDevice({ host: '192.168.1.20' });
  
	if (!device.children) {
	  console.log('TP LINK PLUG: Device has no children');
	  return;
	} else {
		console.log(`TP LINK PLUG: Detected device with ${device.children.keys().length} children`);
	}
  
	await Promise.all(Array.from(device.children.keys(), async (childId) => {
	  let childPlug = await tplinkClient.getDevice({ host: '192.168.1.20', childId });
	  let index = childId.charAt(childId.length - 1);
	  childPlugs[parseInt(index)] = childPlug;
	  console.log(`TP LINK PLUG: Plug with ID ${childId} stored at index ${index}`)
	}));
})();

// Connect to Twitch chat
const tmiClient = new tmi.Client({
	options: { debug: true },
	connection: {
		reconnect: true,
		secure: true
	},
	identity: {
		username: process.env.TWITCH_USER,
		password: process.env.TWITCH_OAUTH
	},
	channels: [ process.env.TWITCH_CHANNEL ]
});

tmiClient.connect();

// Pulse the specified light for 15 seconds, then turn it off
function strobeLight(lightID, color, timeout, stop = true) {
	hueClient.lights.getById(lightID)
		.then(light => {
			console.log('Hue: ' + light.hue);
			console.log(`HUE LIGHT: Strobing light ${light.id} with hue of ${color}`);
			light.on = true;
			light.brightness = 254;
			light.hue = color;
			light.alert = 'lselect'

			return hueClient.lights.save(light);
		})
		.then(light => {
			// If the timeout is over 15000, then renew the strobing at 15 sec intervals
			if (timeout >= 16000) {
				let intervals = 1;
				for (let timeRemaining = timeout - 15000; timeRemaining >= 1000; timeRemaining -= 15000) {
					let nextTimeout = timeRemaining > 15000 ? 15000 : timeRemaining;
					setTimeout(function() {strobeLight(lightID, color, nextTimeout, false);}, 15000 * intervals);
					intervals++;
				}
			}
			if (stop)
				setTimeout(function() {stopLight(lightID);}, timeout);
		})
		.catch(error => {
			console.log('HUE LIGHT: Error modifying light state');
			console.log(error.stack);
		});
}

// Pulses two lights in an alternating pattern
// Ex. alternateStrobing(3, 8, hueColor.red, hueColor.blue, 15000);
function alternateStrobing(light1, light2, color1, color2, timeout) {
	console.log('HUE LIGHT: Alternate strobing');
	strobeLight(light1, color1, timeout);
	setTimeout(function() {strobeLight(light2, color2, timeout);}, 500);
}

// Turn off the specified light
function stopLight(lightID) {
	hueClient.lights.getById(lightID)
		.then(light => {
			console.log(`HUE LIGHT: Turning off light ${light.id}`);
			light.alert = 'none';
			light.on = false;
			return hueClient.lights.save(light);
		})
		.catch(error => {
			console.log('HUE LIGHT: Error modifying light state');
			console.log(error.stack);
		});
}

// Toggle the power switches for a given duration
// wemoState: The state to set the wemo plugs to
// tpState: The state to set the given TP Link plugs to
// tpPlugs: An array of the plug indices for the TP Link power strip
// timeout: The duration to wait before toggling the switches back
function changePowerSwitches(wemoState, tpState, tpPlugs, timeout) {
	if (!wemoState) {
		wemoConnection.setBinaryState(wemoState);
	}
	for (let plug of tpPlugs) {
		childPlugs[plug].setPowerState(tpState).then((powerState, err) => {
			console.log(`Child plug set to power state ${powerState}`);
		});
	}

	// If a timeout is given, toggle the switches back after the timeout expires
	if (timeout > 0) {
		setTimeout(function() {
			// changePowerSwitches(1, tpState ? 0 : 1, tpPlugs, 0);
			if (!wemoState) {
				wemoConnection.setBinaryState(1);
			}
			flipState = tpState ? 0 : 1;
			for (let plug of tpPlugs) {
				childPlugs[plug].setPowerState(flipState).then((powerState, err) => {
					console.log(`Child plug set to power state ${powerState}`);
				});
			}
		}, timeout);
	}
}

let alerts = {
	demo: {
		timeout: 10000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 0,
		tpState: 1,
		tpPlugs: [0, 1, 2, 3, 4, 5],
		sound: './sounds/soundofdapolice.mp3',
		goBig: true
	},
	hello: {
		timeout: 3000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello.mp3',
		goBig: false
	},
	helloabbyfabby: {
		timeout: 11000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-abbyfabby.mp3',
		goBig: false
	},
	helloantivigames: {
		timeout: 6000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-antivigames.mp3',
		goBig: false
	},
	hellobjwhite211: {
		timeout: 9000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-bjwhite211.mp3',
		goBig: false
	},
	hellobrandanf: {
		timeout: 10000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-brandan-f.mp3',
		goBig: false
	},
	hellobungalowglow: {
		timeout: 12000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-bungalowglow.mp3',
		goBig: false
	},
	hellocasinoduckling: {
		timeout: 8000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-casinoduckling.mp3',
		goBig: false
	},
	hellodanhalen: {
		timeout: 9000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-danhalen-us.mp3',
		goBig: false
	},
	hellodragonflythru1: {
		timeout: 11000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-dragonflythru-1.mp3',
		goBig: false
	},
	hellohiccupingboots: {
		timeout: 9000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-hiccupingboots.mp3',
		goBig: false
	},
	helloinstafluff: {
		timeout: 10000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-instafluff.mp3',
		goBig: false
	},
	helloitmeharu: {
		timeout: 11000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-itmeharu.mp3',
		goBig: false
	},
	helloitsayu: {
		timeout: 12000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-its-ayu.mp3',
		goBig: false
	},
	hellojellydance: {
		timeout: 6000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-jellydance.mp3',
		goBig: false
	},
	hellojulieee22: {
		timeout: 11000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-julieee22.mp3',
		goBig: false
	},
	hellolenabotse: {
		timeout: 10000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-lenabotse.mp3',
		goBig: false
	},
	hellomacabreman: {
		timeout: 7000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-macabreman.mp3',
		goBig: false
	},
	hellomalfunct: {
		timeout: 7000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-malfunct.mp3',
		goBig: false
	},
	hellomoddedorange23: {
		timeout: 11000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-moddedorange23.mp3',
		goBig: false
	},
	hellomoriarty24: {
		timeout: 14000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-moriarty24.mp3',
		goBig: false
	},
	hellonitecrawla: {
		timeout: 9000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-nitecrawla.mp3',
		goBig: false
	},
	helloroyoushi: {
		timeout: 8000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-royoushi.mp3',
		goBig: false
	},
	hellosourbeers: {
		timeout: 15000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-sourbeers.mp3',
		goBig: false
	},
	hellosparkypugwash: {
		timeout: 10000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-sparky-pugwash.mp3',
		goBig: false
	},
	helloswolemaz: {
		timeout: 10000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-swolemaz.mp3',
		goBig: false
	},
	hellothatmsgamer: {
		timeout: 12000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-that-ms-gamer.mp3',
		goBig: false
	},
	hellotrueblue7742: {
		timeout: 12000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-trueblue77-42.mp3',
		goBig: false
	},
	helloyoadriennexd: {
		timeout: 17000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4],
		sound: './sounds/hello-yoadriennexd.mp3',
		goBig: false
	},
	senpai: {
		timeout: 6000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [2, 3, 4, 5],
		sound: './sounds/noticemesenpai.mp3',
		goBig: false
	},
	ban: {
		timeout: 8000,
		strobe1: hueColor.blue,
		strobe2: hueColor.red,
		wemoState: 0,
		tpState: 1,
		tpPlugs: [0, 1],
		sound: './sounds/soundofdapolice.mp3',
		goBig: true
	},
	raid: {
		timeout: 21000,
		strobe1: hueColor.red,
		strobe2: hueColor.orange,
		wemoState: 0,
		tpState: 1,
		tpPlugs: [0, 2],
		sound: './sounds/redalert.mp3',
		goBig: true
	},
	subbomb: {
		timeout: 21000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 0,
		tpState: 1,
		tpPlugs: [0, 1, 2, 3, 4, 5],
		sound: './sounds/boom.mp3',
		goBig: true
	},
	tubeman: {
		timeout: 7000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.blue,
		wemoState: 1,
		tpState: 1,
		tpPlugs: [4, 5],
		sound: './sounds/tubeman.mp3',
		goBig: false
	},
	boogie: {
		timeout: 16000,
		strobe1: hueColor.deeppurple,
		strobe2: hueColor.orange,
		wemoState: 0,
		tpState: 1,
		tpPlugs: [0, 1, 2, 3, 4, 5],
		sound: './sounds/boogie.mp3',
		goBig: true
	},
	silence: {
		timeout: 31000,
		strobe1: null,
		strobe2: null,
		wemoState: null,
		tpState: null,
		tpPlugs: null,
		sound: './sounds/countdown.mp3',
		goBig: false
	}
}

let isPaused = false;
let isExecuting = false;
let eventQueue = [];

function triggerLightAndNoise(type) {
	if (isPaused || isExecuting) {
		eventQueue.push(type);
	} else if (type) {
		isExecuting = true;
		let alert = alerts[type];

		if (alert.goBig && currentScene.startsWith('Shop') && currentScene != 'Shop - Starting Soon') {
			obs.send('SetCurrentScene', {'scene-name' : 'Shop - Big Cam'}).then(() => {
				console.log('OBS Websocket: Changing scene to Shop - Big Cam');
            }).catch(err => {
				console.log('OBS Websocket Error: ' + err);
            });
		}

		if (alert.wemoState != null && alert.tpState != null && alert.tpPlugs != null) {
			changePowerSwitches(alert.wemoState, alert.tpState, alert.tpPlugs, alert.timeout);
		}
		
		if (alert.strobe1 && alert.strobe2) {
			alternateStrobing(3, 8, alert.strobe1, alert.strobe2, alert.timeout);
			alternateStrobing(9, 10, alert.strobe1, alert.strobe2, alert.timeout);
		}
		
		if (alert.sound) {
			player.play(alert.sound, function(err){
				if (err) throw err
			});
		}
		setTimeout(function() {
			isExecuting = false;
			triggerLightAndNoise(eventQueue.shift());
		}, alert.timeout + 3000);
	}
}

let welcomedUsers = new Set();
let noticedUsers = new Set();

// Chat message or whisper
tmiClient.on("chat", (channel, userstate, message, self) => {
	let isMod = (userstate['mod'] || userstate['username'] == 'banzaibaby') ? true : false;
	let isSub = userstate['subscriber'] ? userstate['subscriber'] : false;
	let isVip = userstate['badges-raw'] ? userstate['badges-raw'].includes('vip') : false;

	// Create a set with all the emotes in the mssage
	let emotes = userstate['emotes'] ? Object.keys(userstate['emotes']) : [];
	let emoteSet = new Set(emotes);

	message = message.toLowerCase();
	// console.log(`User is ${userstate['username']} with type ${userstate['user-type']} and emotes is ${emotes}`);

	// Allow mods to toggle safemode on or off
	if (isMod && message.startsWith("!safemode")) {
		let words = message.split(' ');
		if (words.length == 1) {
			tmiClient.say(process.env.TWITCH_CHANNEL, `Safe Mode is currently ${isPaused ? 'ON' : 'OFF'}`);
		}
		else if (words[1] == 'on') {
			console.log('SAFE MODE ON');
			isPaused = true;
			tmiClient.say(process.env.TWITCH_CHANNEL, "Safe Mode changed to ON");
		}
		else if (words[1] == 'off') {
			console.log('SAFE MODE OFF');
			isPaused = false;
			tmiClient.say(process.env.TWITCH_CHANNEL, "Safe Mode changed to OFF");
			triggerLightAndNoise(eventQueue.shift());
		}
	}

	// Allow mods to trigger a demo
	if (isMod && message.startsWith("!demo")) {
		triggerLightAndNoise("demo");
	}

	// Allow mods to trigger any sound/light combo
	if (isMod && message.startsWith("!trigger")) {
		let words = message.split(' ');
		if (words[1] in alerts) {
			triggerLightAndNoise(words[1]);
		}
	}

	// If a Mod/Sub/VIP says HeyGuys for the first time that day or anyone uses bzbHey
	if ((((isMod || isSub || isVip) && (emoteSet.has('30259') || emoteSet.has('160400'))) || emoteSet.has('emotesv2_ec3052867f44421896453a73728dfdb6')) && !welcomedUsers.has(userstate['username'])) {
		if (userstate['username'] == 'abbyfabby') {
			triggerLightAndNoise("helloabbyfabby");
		}
		else if (userstate['username'] == 'antivigames') {
			triggerLightAndNoise("helloantivigames");
		}
		else if (userstate['username'] == 'bjwhite211') {
			triggerLightAndNoise("hellobjwhite211");
		}
		else if (userstate['username'] == 'brandanf_') {
			triggerLightAndNoise("hellobrandanf");
		}
		else if (userstate['username'] == 'bungalowglow') {
			triggerLightAndNoise("hellobungalowglow");
		}
		else if (userstate['username'] == 'casinoduckling') {
			triggerLightAndNoise("hellocasinoduckling");
		}
		else if (userstate['username'] == 'danhalen') {
			triggerLightAndNoise("hellodanhalen");
		}
		else if (userstate['username'] == 'dragonflythru_1') {
			triggerLightAndNoise("hellodragonflythru1");
		}
		else if (userstate['username'] == 'hiccupingboots') {
			triggerLightAndNoise("hellohiccupingboots");
		}
		else if (userstate['username'] == 'instafluff') {
			triggerLightAndNoise("helloinstafluff");
		}
		else if (userstate['username'] == 'itmeharu') {
			triggerLightAndNoise("helloitmeharu");
		}
		else if (userstate['username'] == 'itsayu') {
			triggerLightAndNoise("helloitsayu");
		}
		else if (userstate['username'] == 'jellydance') {
			triggerLightAndNoise("hellojellydance");
		}
		else if (userstate['username'] == 'julieee22') {
			triggerLightAndNoise("hellojulieee22");
		}
		else if (userstate['username'] == 'lenabotse') {
			triggerLightAndNoise("hellolenabotse");
		}
		else if (userstate['username'] == 'macabreman') {
			triggerLightAndNoise("hellomacabreman");
		}
		else if (userstate['username'] == 'malfunct') {
			triggerLightAndNoise("hellomalfunct");
		}
		else if (userstate['username'] == 'moddedorange23') {
			triggerLightAndNoise("hellomoddedorange23");
		}
		else if (userstate['username'] == 'moriarty24') {
			triggerLightAndNoise("hellomoriarty24");
		}
		else if (userstate['username'] == 'nitecrawla') {
			triggerLightAndNoise("hellonitecrawla");
		}
		else if (userstate['username'] == 'royoushi') {
			triggerLightAndNoise("helloroyoushi");
		}
		else if (userstate['username'] == 'sourbeers') {
			triggerLightAndNoise("hellosourbeers");
		}
		else if (userstate['username'] == 'sparky_pugwash') {
			triggerLightAndNoise("hellosparkypugwash");
		}
		else if (userstate['username'] == 'swolemaz') {
			triggerLightAndNoise("helloswolemaz");
		}
		else if (userstate['username'] == 'that_ms_gamer') {
			triggerLightAndNoise("hellothatmsgamer");
		}
		else if (userstate['username'] == 'trueblue77_42') {
			triggerLightAndNoise("hellotrueblue7742");
		}
		else if (userstate['username'] == 'yoadriennexd') {
			triggerLightAndNoise("helloyoadriennexd");
		}
		else {
			triggerLightAndNoise("hello");
		}
		welcomedUsers.add(userstate['username']);
	}

	// If someone uses bzbNoticeMe
	if (emoteSet.has('emotesv2_461c6588d71e43c6b95dea6052d15701') && !noticedUsers.has(userstate['username'])) {
		triggerLightAndNoise("senpai");
		noticedUsers.add(userstate['username']);
	}
});

// User has been banned
tmiClient.on("ban", (channel, username, reason, userstate) => {
	triggerLightAndNoise("ban");
});

// User has been timed out
tmiClient.on("timeout", (channel, username, reason, duration, userstate) => {
    if (duration >= 300) {
		triggerLightAndNoise("ban");
	}
});

// Channel has been raided
tmiClient.on("raided", (channel, username, viewers) => {
	if (viewers >= 5) {
		triggerLightAndNoise("raid");
	}
});

// Sub bomb triggered
tmiClient.on("submysterygift", (channel, username, numbOfSubs, methods, userstate) => {
    if (numbOfSubs >= 5) {
		triggerLightAndNoise('subbomb');
	}
});

function redeemReward(data) {
	if (data && data.redemption && data.redemption.reward && data.redemption.reward.title) {
		if(data.redemption.reward.title == 'Tube Man') {
			triggerLightAndNoise('tubeman');
		}
		else if(data.redemption.reward.title == 'Boogie') {
			triggerLightAndNoise('boogie');
		}
		else if(data.redemption.reward.title == 'Choose Any' && data.redemption.user_input) {
			let userInputWords = data.redemption.user_input.toLowerCase().split(' ');
			let triggerFound = false;
			for (let word of userInputWords) {
				if (alerts[word]) {
					triggerLightAndNoise(word);
					triggerFound = true;
					break;
				}
			}
			if (!triggerFound) {
				tmiClient.say(process.env.TWITCH_CHANNEL, "The Choose Any reward was redeemed, but no trigger word was found.");
			}
		}
		else if(data.redemption.reward.title == 'SILENCE') {
			triggerLightAndNoise('silence');
			
            obs.send('SetMute', {'source' : 'Mic/Aux', 'mute': true}).then(() => {
				console.log('OBS Websocket: Mic muted');
				setTimeout(function() {
					obs.send('SetMute', {'source' : 'Mic/Aux', 'mute': false}).then(() => {
						console.log('OBS Websocket: Mic unmuted');
					}).catch(err => {
						console.log('OBS Websocket Error: ' + err);
					});
				}, 30000);
            }).catch(err => {
				console.log('OBS Websocket Error: ' + err);
            });
		}
	}
}